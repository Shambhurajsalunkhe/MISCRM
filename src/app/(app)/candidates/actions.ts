'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { auditedTransaction, prisma } from '@/lib/db'
import { withAudit } from '@/lib/action'
import { nextCandidateCode } from '@/lib/codes'
import {
  contactPhoneFields,
  findCandidateDuplicates,
  recordDuplicateOverride,
} from '@/lib/dedupe'
import { PERMISSIONS } from '@/lib/permissions'
import {
  optionalEmail,
  optionalMoney,
  optionalText,
  optionalUrl,
} from '@/lib/form-fields'
import {
  actionError,
  actionSuccess,
  actionWarning,
  formValues,
  fromZodError,
  optionalString,
  type ActionState,
} from '@/lib/form'

/**
 * The candidate master (README §16, decision D9).
 *
 * One row per person, reused across every requirement they are put forward
 * for — which is the whole point: `Candidates Sourced` counts distinct
 * candidates, so the same person submitted to three clients has to be one row
 * and three submissions or the number is wrong by two.
 *
 * There is no data scope here, only the permission. See
 * `src/app/(app)/candidates/filters.ts` for why a shared master is the right
 * shape and what it does not expose.
 */

const decimalYears = optionalText(6).refine(
  (value) => value === null || /^\d{1,2}(\.\d)?$/.test(value),
  'Enter years as a number, e.g. 6 or 6.5.',
)

const candidateSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter the candidate’s name.').max(160),
  email: optionalEmail,
  phone: optionalText(60),
  currentLocation: optionalText(200),
  preferredLocation: optionalText(200),
  totalExperienceYears: decimalYears,
  primarySkills: optionalText(1000),
  currentEmployer: optionalText(200),
  currentCtc: optionalMoney,
  expectedCtc: optionalMoney,
  noticePeriodDays: optionalText(4).refine(
    (value) => value === null || /^\d{1,4}$/.test(value),
    'Enter a whole number of days.',
  ),
  linkedInProfile: optionalUrl(300),
  sourceChannel: optionalText(80),
  notes: optionalText(4000),
})

type CandidateData = z.infer<typeof candidateSchema>

/** The shape both writes share, with the phone's two columns built together. */
function candidateRow(data: CandidateData) {
  return {
    fullName: data.fullName,
    email: data.email,
    ...contactPhoneFields(data.phone),
    currentLocation: data.currentLocation,
    preferredLocation: data.preferredLocation,
    totalExperienceYears: data.totalExperienceYears,
    primarySkills: data.primarySkills,
    currentEmployer: data.currentEmployer,
    currentCtc: data.currentCtc,
    expectedCtc: data.expectedCtc,
    noticePeriodDays: data.noticePeriodDays
      ? Number(data.noticePeriodDays)
      : null,
    linkedInProfile: data.linkedInProfile,
    sourceChannel: data.sourceChannel,
    notes: data.notes,
  }
}

export async function createCandidateAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let createdId: string | null = null

  const result = await withAudit(
    PERMISSIONS.STAFFING_CANDIDATE_MANAGE,
    async (actor) => {
      const parsed = candidateSchema.safeParse(formValues(formData))
      if (!parsed.success) return fromZodError(parsed.error)

      const data = parsed.data
      const overrideReason = optionalString(formData.get('overrideReason'))

      const duplicates = await findCandidateDuplicates({
        email: data.email,
        phone: data.phone,
      })

      if (duplicates.length > 0 && !overrideReason) {
        return actionWarning(
          'This person may already be in the master. Open the match and submit that profile instead, or give a reason to add a second record.',
          duplicates,
        )
      }

      const candidate = await auditedTransaction(async (tx) =>
        tx.candidate.create({
          data: {
            ...candidateRow(data),
            candidateCode: await nextCandidateCode(tx),
            createdById: actor.id,
          },
          select: { id: true, candidateCode: true, fullName: true },
        }),
      )

      // Only once the row exists — a justification recorded against a save that
      // failed would point at nothing. The form promised this would be kept.
      if (overrideReason) {
        await recordDuplicateOverride({
          entityType: 'CANDIDATE',
          entityId: candidate.id,
          reason: overrideReason,
          warnings: duplicates,
          userId: actor.id,
        })
      }

      createdId = candidate.id
      revalidatePath('/candidates')
      return actionSuccess(`${candidate.fullName} added as ${candidate.candidateCode}.`)
    },
  )

  // Outside the wrapper: `redirect` throws, which inside the transaction body
  // would roll back the candidate that was just created.
  if (result.status === 'success' && createdId) {
    redirect(`/candidates/${createdId}`)
  }

  return result
}

export async function updateCandidateAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.STAFFING_CANDIDATE_MANAGE, async (actor) => {
    const id = formData.get('id')
    if (typeof id !== 'string' || id === '') {
      return actionError('Missing candidate id.')
    }

    const existing = await prisma.candidate.findFirst({
      where: { id, isDeleted: false },
      select: { id: true },
    })
    if (!existing) return actionError('That candidate no longer exists.')

    const parsed = candidateSchema.safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const data = parsed.data
    const overrideReason = optionalString(formData.get('overrideReason'))

    const duplicates = await findCandidateDuplicates({
      email: data.email,
      phone: data.phone,
      excludeCandidateId: id,
    })

    if (duplicates.length > 0 && !overrideReason) {
      return actionWarning(
        'These details now match another profile in the master. Give a reason to keep both.',
        duplicates,
      )
    }

    await prisma.candidate.update({ where: { id }, data: candidateRow(data) })

    if (overrideReason) {
      await recordDuplicateOverride({
        entityType: 'CANDIDATE',
        entityId: id,
        reason: overrideReason,
        warnings: duplicates,
        userId: actor.id,
      })
    }

    revalidatePath('/candidates')
    revalidatePath(`/candidates/${id}`)
    return actionSuccess('Changes saved.')
  })
}

/**
 * Retire or restore a candidate.
 *
 * `isActive`, not a delete: someone who has left the market should stop
 * appearing in every skill search, but their submissions and any placement
 * against them are history that the staffing report reads. A retired candidate
 * keeps counting in the periods they were actually worked.
 */
export async function setCandidateActiveAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.STAFFING_CANDIDATE_MANAGE, async () => {
    const id = formData.get('id')
    const isActive = formData.get('isActive') === 'true'

    if (typeof id !== 'string' || id === '') {
      return actionError('Missing candidate id.')
    }

    const candidate = await prisma.candidate.findFirst({
      where: { id, isDeleted: false },
      select: { id: true, fullName: true },
    })
    if (!candidate) return actionError('That candidate no longer exists.')

    await prisma.candidate.update({ where: { id }, data: { isActive } })

    revalidatePath('/candidates')
    revalidatePath(`/candidates/${id}`)
    return actionSuccess(
      isActive
        ? `${candidate.fullName} is active again.`
        : `${candidate.fullName} retired. Their submissions and placements are untouched.`,
    )
  })
}

/** Soft delete (open question Q10), refused once the profile has been used. */
export async function deleteCandidateAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.LEAD_DELETE, async () => {
    const id = formData.get('id')
    if (typeof id !== 'string' || id === '') {
      return actionError('Missing candidate id.')
    }

    const candidate = await prisma.candidate.findFirst({
      where: { id, isDeleted: false },
      select: {
        id: true,
        fullName: true,
        _count: { select: { submissions: true } },
      },
    })
    if (!candidate) return actionError('That candidate no longer exists.')

    // A submitted candidate is part of a client conversation and of every
    // `subReached` count in the staffing funnel. Hiding the row would leave
    // those submissions pointing at a profile no screen can open. Retiring is
    // the answer, and it is one click away on the same page.
    if (candidate._count.submissions > 0) {
      return actionError(
        `${candidate.fullName} has been submitted to ${candidate._count.submissions} requirement${candidate._count.submissions === 1 ? '' : 's'} and cannot be deleted. Retire the profile instead.`,
      )
    }

    await prisma.candidate.update({ where: { id }, data: { isDeleted: true } })

    revalidatePath('/candidates')
    revalidatePath(`/candidates/${id}`)
    return actionSuccess(`${candidate.fullName} deleted.`)
  })
}
