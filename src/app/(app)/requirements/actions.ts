'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { auditedTransaction, prisma } from '@/lib/db'
import { withAudit } from '@/lib/action'
import { can } from '@/lib/authz'
import { nextRequirementCode } from '@/lib/codes'
import { PERMISSIONS } from '@/lib/permissions'
import {
  changeRequirementStage,
  setInitialRequirementStage,
  setRequirementStatus,
} from '@/lib/staffing/requirement'
import {
  changeSubmissionStage,
  firstSubmissionStage,
  recordInitialSubmissionStage,
} from '@/lib/staffing/submission'
import { leadVisibilityFilter, requirementVisibilityFilter } from '@/lib/visibility'
import {
  optionalDate,
  optionalId,
  optionalMoney,
  optionalText,
} from '@/lib/form-fields'
import {
  actionError,
  actionSuccess,
  formValues,
  fromZodError,
  optionalString,
  type ActionState,
} from '@/lib/form'
import type { CurrentUser } from '@/lib/auth/session'

/**
 * Staffing requirements and the candidate submissions under them (README §14
 * and §16).
 *
 * Every mutation here is gated on `STAFFING_REQUIREMENT_MANAGE` except the
 * submission board, which is gated on `STAFFING_CANDIDATE_MANAGE` — the
 * permission matrix in docs/03 §2 gives a BDE the second and not the first,
 * because sourcing and submitting profiles is the recruiting job while raising
 * and closing the requirement is the account job.
 */

const experience = optionalText(10).refine(
  (value) => value === null || /^\d{1,2}(\.\d)?$/.test(value),
  'Enter years as a number, e.g. 4 or 4.5.',
)

const requirementSchema = z.object({
  position: z.string().trim().min(2, 'Name the position.').max(200),
  requirementTypeId: optionalId,
  openings: z
    .string()
    .trim()
    .default('1')
    .refine((value) => /^\d{1,3}$/.test(value), 'Enter a whole number of openings.')
    .transform(Number)
    .refine((value) => value >= 1, 'A requirement needs at least one opening.'),
  skills: optionalText(1000),
  minExperience: experience,
  maxExperience: experience,
  location: optionalText(200),
  workMode: optionalText(40),
  budgetMin: optionalMoney,
  budgetMax: optionalMoney,
  targetDate: optionalDate,
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  description: optionalText(4000),
  assignedToId: optionalId,
})

/** A requirement this user may open. */
async function visibleRequirement(user: CurrentUser, id: string) {
  return prisma.requirement.findFirst({
    where: { id, isDeleted: false, ...(await requirementVisibilityFilter(user)) },
    select: {
      id: true,
      requirementCode: true,
      leadId: true,
      clientId: true,
      openings: true,
      positionsFilled: true,
    },
  })
}

export async function createRequirementAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let createdId: string | null = null

  const result = await withAudit(
    PERMISSIONS.STAFFING_REQUIREMENT_MANAGE,
    async (actor) => {
      const leadId = optionalString(formData.get('leadId'))
      if (!leadId) {
        return actionError('A requirement has to belong to a lead.', {
          leadId: 'Choose the staffing lead this came from.',
        })
      }

      // The lead, not the client, is the parent (docs/01 §2): one client
      // engagement raises many requirements, and the whole point of that shape
      // is that a returning client does not become a second account.
      const lead = await prisma.lead.findFirst({
        where: {
          id: leadId,
          isDeleted: false,
          ...(await leadVisibilityFilter(actor)),
        },
        select: {
          id: true,
          leadCode: true,
          clientId: true,
          assignedToId: true,
          vertical: { select: { name: true, usesRequirements: true } },
        },
      })

      if (!lead) {
        return actionError('That lead is not available.', {
          leadId: 'Choose a lead you can see.',
        })
      }

      // Read off the vertical's module switch rather than a list of vertical
      // codes, the same way the lead form decides which sections to render. A
      // ninth vertical that turns requirements on gets them with no code change.
      if (!lead.vertical.usesRequirements) {
        return actionError(
          `${lead.vertical.name} leads do not carry requirements. Turn the requirements module on for the vertical in Master Data if that is wrong.`,
          { leadId: 'This lead’s vertical has no requirements module.' },
        )
      }

      const parsed = requirementSchema.safeParse(formValues(formData))
      if (!parsed.success) return fromZodError(parsed.error)

      const data = parsed.data

      const rangeError = checkRanges(data)
      if (rangeError) return rangeError

      // Unassigned falls to whoever is working the lead. A requirement nobody
      // owns is a requirement nobody chases, and the lead's assignee is the
      // person who just heard about it.
      //
      // The two paths fail differently on purpose. An owner the user actually
      // picked has to be a real active user, and saying so is useful. An owner
      // *inherited* from the lead falls back to unassigned when that person has
      // since been deactivated — refusing there would reject the requirement
      // over a field the user left blank, with an error pointing at a control
      // they never touched and no way to proceed but to guess.
      let assignedToId: string | null = null

      if (data.assignedToId) {
        const owner = await prisma.user.findFirst({
          where: { id: data.assignedToId, isActive: true },
          select: { id: true },
        })
        if (!owner) {
          return actionError('That user is not available.', {
            assignedToId: 'Choose an active user.',
          })
        }
        assignedToId = owner.id
      } else if (lead.assignedToId) {
        const owner = await prisma.user.findFirst({
          where: { id: lead.assignedToId, isActive: true },
          select: { id: true },
        })
        assignedToId = owner?.id ?? null
      }

      const now = new Date()

      const requirement = await auditedTransaction(async (tx) => {
        const created = await tx.requirement.create({
          data: {
            requirementCode: await nextRequirementCode(tx),
            leadId: lead.id,
            // Denormalised from the lead so the client page can list every
            // requirement without joining through leads, and so a requirement
            // keeps naming its client if the lead is ever re-parented.
            clientId: lead.clientId,
            position: data.position,
            requirementTypeId: data.requirementTypeId,
            openings: data.openings,
            skills: data.skills,
            minExperience: data.minExperience,
            maxExperience: data.maxExperience,
            location: data.location,
            workMode: data.workMode,
            budgetMin: data.budgetMin,
            budgetMax: data.budgetMax,
            targetDate: data.targetDate,
            priority: data.priority,
            description: data.description,
            assignedToId,
            createdById: actor.id,
            stageChangedAt: now,
          },
          select: { id: true, requirementCode: true },
        })

        await setInitialRequirementStage(tx, {
          requirementId: created.id,
          actorId: actor.id,
          at: now,
        })

        return created
      })

      createdId = requirement.id
      revalidatePath('/requirements')
      revalidatePath(`/leads/${lead.id}/requirements`)
      revalidatePath(`/clients/${lead.clientId}`)
      return actionSuccess(`${requirement.requirementCode} created.`)
    },
  )

  // Outside the wrapper: `redirect` throws, and throwing inside the transaction
  // body would roll back the requirement that was just created.
  if (result.status === 'success' && createdId) {
    redirect(`/requirements/${createdId}`)
  }

  return result
}

export async function updateRequirementAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.STAFFING_REQUIREMENT_MANAGE, async (actor) => {
    const id = formData.get('id')
    if (typeof id !== 'string' || id === '') {
      return actionError('Missing requirement id.')
    }

    const requirement = await visibleRequirement(actor, id)
    if (!requirement) {
      return actionError('That requirement no longer exists.')
    }

    const parsed = requirementSchema.safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const data = parsed.data

    const rangeError = checkRanges(data)
    if (rangeError) return rangeError

    // Openings cannot drop below what has already been filled. `positionsFilled`
    // is incremented by real `Placement` rows, so allowing it would leave a
    // requirement reporting three of two filled and a Fill Rate over 100%.
    if (data.openings < requirement.positionsFilled) {
      return actionError(
        `${requirement.requirementCode} already has ${requirement.positionsFilled} placement${requirement.positionsFilled === 1 ? '' : 's'} against it.`,
        { openings: `Cannot be fewer than ${requirement.positionsFilled}.` },
      )
    }

    if (data.assignedToId) {
      const owner = await prisma.user.findFirst({
        where: { id: data.assignedToId, isActive: true },
        select: { id: true },
      })
      if (!owner) {
        return actionError('That user is not available.', {
          assignedToId: 'Choose an active user.',
        })
      }
    }

    await prisma.requirement.update({ where: { id }, data })

    revalidatePath('/requirements')
    revalidatePath(`/requirements/${id}`)
    revalidatePath(`/leads/${requirement.leadId}/requirements`)
    return actionSuccess('Changes saved.')
  })
}

/** Both ends of a numeric range, checked together rather than field by field. */
function checkRanges(data: {
  minExperience: string | null
  maxExperience: string | null
  budgetMin: number | null
  budgetMax: number | null
}): ActionState | null {
  if (
    data.minExperience !== null &&
    data.maxExperience !== null &&
    Number(data.minExperience) > Number(data.maxExperience)
  ) {
    return actionError('The experience range runs backwards.', {
      maxExperience: 'Must be at least the minimum.',
    })
  }

  if (
    data.budgetMin !== null &&
    data.budgetMax !== null &&
    data.budgetMin > data.budgetMax
  ) {
    return actionError('The budget range runs backwards.', {
      budgetMax: 'Must be at least the minimum.',
    })
  }

  return null
}

export async function changeRequirementStageAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.STAFFING_REQUIREMENT_MANAGE, async (actor) => {
    const id = formData.get('id')
    const toStageId = formData.get('toStageId')

    if (typeof id !== 'string' || id === '') {
      return actionError('Missing requirement id.')
    }
    if (typeof toStageId !== 'string' || toStageId === '') {
      return actionError('Choose a stage.', { toStageId: 'Choose a stage.' })
    }

    const requirement = await visibleRequirement(actor, id)
    if (!requirement) {
      return actionError('That requirement no longer exists.')
    }

    const result = await changeRequirementStage({
      requirementId: requirement.id,
      toStageId,
      actorId: actor.id,
      reason: optionalString(formData.get('reason')),
      lostReasonId: optionalString(formData.get('lostReasonId')),
    })

    if (!result.ok) {
      return actionError(
        result.message,
        result.field ? { [result.field]: result.message } : undefined,
      )
    }

    revalidateRequirement(requirement)
    return actionSuccess(
      `${result.requirementCode} moved to ${result.stageName}.`,
    )
  })
}

export async function setRequirementStatusAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.STAFFING_REQUIREMENT_MANAGE, async (actor) => {
    const id = formData.get('id')
    const status = formData.get('status')

    if (typeof id !== 'string' || id === '') {
      return actionError('Missing requirement id.')
    }
    if (status !== 'ON_HOLD' && status !== 'CANCELLED' && status !== 'OPEN') {
      return actionError('That is not a status this control can set.')
    }

    const requirement = await visibleRequirement(actor, id)
    if (!requirement) {
      return actionError('That requirement no longer exists.')
    }

    const result = await setRequirementStatus({
      requirementId: requirement.id,
      status,
      actorId: actor.id,
      reason: optionalString(formData.get('reason')),
    })

    if (!result.ok) return actionError(result.message)

    revalidateRequirement(requirement)
    return actionSuccess(
      status === 'ON_HOLD'
        ? `${result.requirementCode} put on hold.`
        : status === 'CANCELLED'
          ? `${result.requirementCode} cancelled.`
          : `${result.requirementCode} resumed.`,
    )
  })
}

/** Soft delete (open question Q10) — the row and all its history survive. */
export async function deleteRequirementAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.LEAD_DELETE, async (actor) => {
    const id = formData.get('id')
    if (typeof id !== 'string' || id === '') {
      return actionError('Missing requirement id.')
    }

    const requirement = await visibleRequirement(actor, id)
    if (!requirement) {
      return actionError('That requirement no longer exists.')
    }

    // A requirement with placements against it is booked revenue. Hiding it
    // would leave the placements pointing at a record that no list shows, and
    // the lead's derived outcome resting on a requirement nobody can open.
    if (requirement.positionsFilled > 0) {
      return actionError(
        `${requirement.requirementCode} has placements recorded against it and cannot be deleted. Cancel it instead if the work stopped.`,
      )
    }

    await prisma.requirement.update({
      where: { id },
      data: { isDeleted: true },
    })

    revalidateRequirement(requirement)
    return actionSuccess(
      `${requirement.requirementCode} deleted. Its history is intact and an administrator can restore it.`,
    )
  })
}

/**
 * Put a candidate forward for a requirement.
 *
 * The unique index on `(requirementId, candidateId)` is what actually stops a
 * double submission; the check here exists only to turn the constraint
 * violation into a sentence naming the person.
 */
export async function submitCandidateAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.STAFFING_CANDIDATE_MANAGE, async (actor) => {
    const requirementId = optionalString(formData.get('requirementId'))
    const candidateId = optionalString(formData.get('candidateId'))

    if (!requirementId) return actionError('Missing requirement id.')
    if (!candidateId) {
      return actionError('Choose a candidate.', {
        candidateId: 'Choose a candidate, or add one to the master first.',
      })
    }

    const requirement = await visibleRequirement(actor, requirementId)
    if (!requirement) {
      return actionError('That requirement no longer exists.')
    }

    const candidate = await prisma.candidate.findFirst({
      where: { id: candidateId, isDeleted: false, isActive: true },
      select: { id: true, fullName: true },
    })

    if (!candidate) {
      return actionError('That candidate is not available.', {
        candidateId: 'Choose an active candidate.',
      })
    }

    const existing = await prisma.candidateSubmission.findUnique({
      where: {
        requirementId_candidateId: {
          requirementId: requirement.id,
          candidateId: candidate.id,
        },
      },
      select: { id: true },
    })

    if (existing) {
      return actionError(
        `${candidate.fullName} has already been submitted to ${requirement.requirementCode}.`,
        { candidateId: 'Already on this requirement.' },
      )
    }

    const offeredSalary = optionalMoney.safeParse(
      String(formData.get('offeredSalary') ?? ''),
    )
    const billRate = optionalMoney.safeParse(
      String(formData.get('billRate') ?? ''),
    )

    if (!offeredSalary.success || !billRate.success) {
      return actionError('Enter valid amounts, or leave them blank.', {
        ...(offeredSalary.success ? {} : { offeredSalary: 'Enter an amount.' }),
        ...(billRate.success ? {} : { billRate: 'Enter an amount.' }),
      })
    }

    const now = new Date()

    try {
      await auditedTransaction(async (tx) => {
        const stage = await firstSubmissionStage(tx)
        if (!stage) {
          throw new NoCandidateStagesError()
        }

        const submission = await tx.candidateSubmission.create({
          data: {
            requirementId: requirement.id,
            candidateId: candidate.id,
            currentStageId: stage.id,
            submittedById: actor.id,
            submittedAt: now,
            stageChangedAt: now,
            offeredSalary: offeredSalary.data,
            billRate: billRate.data,
          },
          select: { id: true },
        })

        await recordInitialSubmissionStage(tx, {
          submissionId: submission.id,
          stageId: stage.id,
          actorId: actor.id,
          at: now,
        })

        await tx.activity.create({
          data: {
            type: 'NOTE',
            subject: `${candidate.fullName} submitted`,
            notes: optionalString(formData.get('note')),
            activityDate: now,
            userId: actor.id,
            requirementId: requirement.id,
          },
        })
      })
    } catch (error) {
      if (error instanceof NoCandidateStagesError) {
        return actionError(
          'There are no active candidate stages. An administrator needs to restore the candidate stage list in Master Data before profiles can be submitted.',
        )
      }
      // The unique index, if two people submitted the same person at once.
      if ((error as { code?: string }).code === 'P2002') {
        return actionError(
          `${candidate.fullName} has already been submitted to ${requirement.requirementCode}.`,
          { candidateId: 'Already on this requirement.' },
        )
      }
      throw error
    }

    revalidatePath(`/requirements/${requirement.id}`)
    revalidatePath(`/candidates/${candidate.id}`)
    return actionSuccess(
      `${candidate.fullName} submitted to ${requirement.requirementCode}.`,
    )
  })
}

/** Thrown inside the transaction so the rollback happens before the message. */
class NoCandidateStagesError extends Error {}

export async function changeSubmissionStageAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.STAFFING_CANDIDATE_MANAGE, async (actor) => {
    const id = formData.get('id')
    const toStageId = formData.get('toStageId')

    if (typeof id !== 'string' || id === '') {
      return actionError('Missing submission id.')
    }
    if (typeof toStageId !== 'string' || toStageId === '') {
      return actionError('Choose a stage.', { toStageId: 'Choose a stage.' })
    }

    const submission = await prisma.candidateSubmission.findFirst({
      where: {
        id,
        requirement: {
          isDeleted: false,
          ...(await requirementVisibilityFilter(actor)),
        },
      },
      select: {
        id: true,
        requirementId: true,
        candidateId: true,
        requirement: { select: { leadId: true, clientId: true } },
      },
    })

    if (!submission) {
      return actionError('That submission no longer exists.')
    }

    // Recording a placement is booking revenue, which the permission matrix
    // separates from working the pipeline — the same line `LEAD_COMMERCIAL`
    // draws for marking a lead Won.
    const toStage = await prisma.candidateStage.findUnique({
      where: { id: toStageId },
      select: { isPlaced: true },
    })

    if (
      toStage?.isPlaced &&
      !(await can(actor, PERMISSIONS.STAFFING_REQUIREMENT_MANAGE))
    ) {
      return actionError(
        'Recording a placement books revenue against this requirement, which your role does not include. Ask whoever owns the requirement to mark the join.',
      )
    }

    const parsed = placementFields(formData)
    if (!parsed.ok) return parsed.state

    const result = await changeSubmissionStage({
      submissionId: submission.id,
      toStageId,
      actorId: actor.id,
      note: optionalString(formData.get('note')),
      clientFeedback: optionalString(formData.get('clientFeedback')),
      rejectedReason: optionalString(formData.get('rejectedReason')),
      placement: parsed.placement,
    })

    if (!result.ok) {
      return actionError(
        result.message,
        result.field ? { [result.field]: result.message } : undefined,
      )
    }

    revalidatePath(`/requirements/${submission.requirementId}`)
    revalidatePath(`/requirements/${submission.requirementId}/submissions/${submission.id}`)
    revalidatePath(`/candidates/${submission.candidateId}`)
    revalidatePath('/requirements')
    if (result.placed) {
      revalidatePath('/placements')
      revalidatePath(`/leads/${submission.requirement.leadId}`)
    }

    return actionSuccess(`${result.candidateName} moved to ${result.stageName}.`)
  })
}

/**
 * The placement half of the submission form, parsed only when it is present.
 *
 * These fields are rendered by the board only for the joined stage, so they are
 * absent — not blank — for every other move. `optionalMoney` and `optionalDate`
 * already treat the two the same way, which is exactly why they exist (see
 * `src/lib/form-fields.ts`).
 */
function placementFields(
  formData: FormData,
):
  | { ok: true; placement: Parameters<typeof changeSubmissionStage>[0]['placement'] }
  | { ok: false; state: ActionState } {
  const schema = z.object({
    joiningDate: optionalDate,
    placementValue: optionalMoney,
    salary: optionalMoney,
    billRate: optionalMoney,
    marginPerMonth: optionalMoney,
    guaranteePeriodDays: optionalText(4).refine(
      (value) => value === null || /^\d{1,4}$/.test(value),
      'Enter a whole number of days.',
    ),
  })

  const parsed = schema.safeParse(formValues(formData))
  if (!parsed.success) return { ok: false, state: fromZodError(parsed.error) }

  const data = parsed.data

  return {
    ok: true,
    placement: {
      joiningDate: data.joiningDate,
      placementValue: data.placementValue,
      salary: data.salary,
      billRate: data.billRate,
      marginPerMonth: data.marginPerMonth,
      guaranteePeriodDays: data.guaranteePeriodDays
        ? Number(data.guaranteePeriodDays)
        : null,
    },
  }
}

/**
 * A submission this user may work on, with the fields the interview actions
 * need. Scoped through the requirement, like everything else on the board.
 */
async function visibleSubmission(user: CurrentUser, id: string) {
  return prisma.candidateSubmission.findFirst({
    where: {
      id,
      requirement: {
        isDeleted: false,
        ...(await requirementVisibilityFilter(user)),
      },
    },
    select: {
      id: true,
      requirementId: true,
      candidate: { select: { fullName: true } },
    },
  })
}

const interviewSchema = z.object({
  scheduledAt: optionalDate,
  mode: optionalText(40),
  interviewerName: optionalText(120),
})

/**
 * Add an interview round to a submission (README §16).
 *
 * The round number is issued here rather than typed, from the rounds already
 * recorded — a second-round interview entered as round 1 would make the
 * Interviews count right and the sequence on screen wrong, and nobody would
 * notice until they were reading a candidate's history in a debrief.
 *
 * Scheduling an interview deliberately does *not* move the submission's stage.
 * The candidate stage list is master data an administrator can rename or
 * reorder, so inferring "this means Interview Scheduled" would be this module
 * hard-coding a stage by meaning — exactly what the funnel builder and the lead
 * form were both written to avoid. The board is where stages move.
 */
export async function scheduleInterviewAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.STAFFING_CANDIDATE_MANAGE, async (actor) => {
    const submissionId = optionalString(formData.get('submissionId'))
    if (!submissionId) return actionError('Missing submission id.')

    const submission = await visibleSubmission(actor, submissionId)
    if (!submission) return actionError('That submission no longer exists.')

    const parsed = interviewSchema.safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const data = parsed.data
    if (!data.scheduledAt) {
      return actionError('Enter when the interview is.', {
        scheduledAt: 'Choose a date and time.',
      })
    }

    const now = new Date()

    await auditedTransaction(async (tx) => {
      const last = await tx.interview.findFirst({
        where: { submissionId: submission.id },
        orderBy: { roundNumber: 'desc' },
        select: { roundNumber: true },
      })

      const roundNumber = (last?.roundNumber ?? 0) + 1

      await tx.interview.create({
        data: {
          submissionId: submission.id,
          roundNumber,
          scheduledAt: data.scheduledAt!,
          mode: data.mode,
          interviewerName: data.interviewerName,
        },
      })

      await tx.activity.create({
        data: {
          type: 'INTERVIEW',
          subject: `${submission.candidate.fullName}: round ${roundNumber} scheduled`,
          notes: data.interviewerName
            ? `Interviewer: ${data.interviewerName}`
            : null,
          activityDate: now,
          followUpDate: data.scheduledAt,
          userId: actor.id,
          requirementId: submission.requirementId,
        },
      })
    })

    revalidateSubmission(submission)
    return actionSuccess('Interview scheduled.')
  })
}

/**
 * Record what happened in a round.
 *
 * `completedAt` is stamped by the outcome rather than entered: an interview
 * with a result is an interview that happened, and a separate date field is one
 * more thing to leave blank. A round put back to Pending is un-stamped, so
 * "interviews completed" never counts a round somebody re-opened.
 */
export async function recordInterviewResultAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.STAFFING_CANDIDATE_MANAGE, async (actor) => {
    const id = optionalString(formData.get('id'))
    if (!id) return actionError('Missing interview id.')

    const result = formData.get('result')
    if (
      result !== 'PENDING' &&
      result !== 'SELECTED' &&
      result !== 'REJECTED' &&
      result !== 'ON_HOLD' &&
      result !== 'NO_SHOW'
    ) {
      return actionError('Choose an outcome.', { result: 'Choose an outcome.' })
    }

    const interview = await prisma.interview.findUnique({
      where: { id },
      select: { id: true, roundNumber: true, submissionId: true, completedAt: true },
    })
    if (!interview) return actionError('That interview no longer exists.')

    const submission = await visibleSubmission(actor, interview.submissionId)
    if (!submission) return actionError('That submission no longer exists.')

    const feedback = optionalText(4000).safeParse(
      String(formData.get('feedback') ?? ''),
    )
    if (!feedback.success) return fromZodError(feedback.error)

    const now = new Date()

    await prisma.interview.update({
      where: { id },
      data: {
        result,
        feedback: feedback.data,
        completedAt:
          result === 'PENDING' ? null : (interview.completedAt ?? now),
      },
    })

    revalidateSubmission(submission)
    return actionSuccess(`Round ${interview.roundNumber} updated.`)
  })
}

/**
 * Remove an interview round.
 *
 * Hard, for the same reason an activity is: a round scheduled against the wrong
 * candidate is a mistake, not a business record with dependants, and the audit
 * trail keeps what was removed.
 */
export async function deleteInterviewAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.STAFFING_CANDIDATE_MANAGE, async (actor) => {
    const id = optionalString(formData.get('id'))
    if (!id) return actionError('Missing interview id.')

    const interview = await prisma.interview.findUnique({
      where: { id },
      select: { id: true, submissionId: true, roundNumber: true },
    })
    if (!interview) return actionError('That interview no longer exists.')

    const submission = await visibleSubmission(actor, interview.submissionId)
    if (!submission) return actionError('That submission no longer exists.')

    await prisma.interview.delete({ where: { id } })

    revalidateSubmission(submission)
    return actionSuccess(`Round ${interview.roundNumber} removed.`)
  })
}

function revalidateSubmission(submission: { id: string; requirementId: string }) {
  revalidatePath(`/requirements/${submission.requirementId}`)
  revalidatePath(
    `/requirements/${submission.requirementId}/submissions/${submission.id}`,
  )
}

function revalidateRequirement(requirement: {
  id: string
  leadId: string
  clientId: string
}) {
  revalidatePath('/requirements')
  revalidatePath(`/requirements/${requirement.id}`)
  revalidatePath(`/leads/${requirement.leadId}`)
  revalidatePath(`/leads/${requirement.leadId}/requirements`)
  revalidatePath(`/clients/${requirement.clientId}`)
}
