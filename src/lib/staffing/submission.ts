import 'server-only'

import { auditedTransaction, type TransactionClient } from '@/lib/db'
import { recordAudit } from '@/lib/audit/record'
import { applyRequirementStage } from '@/lib/staffing/requirement'
import { syncStaffingLeadOutcome } from '@/lib/staffing/lead-outcome'

/**
 * The candidate submission engine — the third level of docs/01-data-model.md §2.
 *
 * A submission is the join between a requirement and a candidate, and it is
 * where the recruiter's day actually happens: profile shared, shortlisted,
 * interviewed, selected, joined. Its transitions are counted by
 * `subReached(CODE)` in docs/02 §4.7, read from `CandidateStageHistory` — so,
 * exactly as at the two levels above, the history row is the record and
 * `currentStageId` is only the pointer.
 *
 * The one place this engine does more than move a pointer is the placed stage.
 * Joining is the moment a staffing deal becomes revenue (decision D8), and four
 * things become true at once:
 *
 *   1. A `Placement` row exists — the revenue unit, one per person who joins.
 *   2. `Requirement.positionsFilled` goes up by one.
 *   3. The requirement moves to its winning stage, becoming `FILLED` if that was
 *      the last opening and `PARTIALLY_FILLED` if openings remain.
 *   4. The lead's derived outcome follows (via `applyRequirementStage`).
 *
 * Doing any of those without the others produces a number that disagrees with
 * the one beside it: a placement with no `positionsFilled` breaks Fill Rate, a
 * filled requirement with no placement breaks Won Revenue.
 */

export type SubmissionStageResult =
  | { ok: true; candidateName: string; stageName: string; placed: boolean }
  | { ok: false; message: string; field?: string }

/** What the placed stage needs before it can be entered. */
export type PlacementInput = {
  joiningDate: Date | null
  placementValue: number | null
  salary?: number | null
  billRate?: number | null
  marginPerMonth?: number | null
  guaranteePeriodDays?: number | null
}

export async function changeSubmissionStage(input: {
  submissionId: string
  toStageId: string
  actorId: string
  note: string | null
  clientFeedback?: string | null
  rejectedReason?: string | null
  placement?: PlacementInput
}): Promise<SubmissionStageResult> {
  return auditedTransaction(async (tx) => {
    const submission = await tx.candidateSubmission.findUnique({
      where: { id: input.submissionId },
      select: {
        id: true,
        currentStageId: true,
        stageChangedAt: true,
        candidateId: true,
        requirementId: true,
        candidate: { select: { fullName: true } },
        currentStage: { select: { id: true, name: true, sortOrder: true, isPlaced: true } },
        placement: { select: { id: true } },
        requirement: {
          select: {
            id: true,
            requirementCode: true,
            leadId: true,
            openings: true,
            positionsFilled: true,
            currentStageId: true,
            stageChangedAt: true,
          },
        },
      },
    })

    if (!submission) {
      return { ok: false as const, message: 'That submission no longer exists.' }
    }

    const toStage = await tx.candidateStage.findUnique({
      where: { id: input.toStageId },
      select: {
        id: true,
        name: true,
        sortOrder: true,
        isPlaced: true,
        isRejected: true,
        isActive: true,
      },
    })

    if (!toStage || !toStage.isActive) {
      return {
        ok: false as const,
        message: 'That stage is not available. Choose another.',
        field: 'toStageId',
      }
    }

    if (submission.currentStageId === toStage.id) {
      return {
        ok: false as const,
        message: `${submission.candidate.fullName} is already at ${toStage.name}.`,
        field: 'toStageId',
      }
    }

    // Undoing a placement is a revenue event, not a stage correction: the
    // `Placement` row is what Won Revenue sums, and invoices are raised against
    // it. Deleting one quietly from a stage dropdown would change a number on
    // the dashboard with nothing to explain it.
    //
    // Phase 5 defined the alternative rather than leaving the refusal absolute:
    // `reversePlacement` in src/lib/staffing/placement.ts writes a reversal, on
    // the placement register, with a mandatory reason and the invoices checked
    // first. This still refuses, but it now refuses towards somewhere.
    //
    // The current *stage* is checked as well as the placement row, so a move
    // from one placed stage to another is refused too. Without it, a second
    // placed stage in the list would send an already-placed submission back
    // through `recordPlacement`, where `Placement.submissionId`'s unique index
    // would surface as an unhandled constraint error rather than this sentence.
    if (submission.placement || submission.currentStage.isPlaced) {
      return {
        ok: false as const,
        message: `${submission.candidate.fullName} has a placement recorded against this requirement. Reversing it changes booked revenue, so it is done from the placement register with a reason attached rather than from a stage dropdown.`,
        field: 'toStageId',
      }
    }

    const now = new Date()

    if (toStage.isPlaced) {
      const failure = await recordPlacement(tx, {
        submission,
        placement: input.placement,
        actorId: input.actorId,
        at: now,
      })
      if (failure) return failure
    }

    await tx.candidateSubmission.update({
      where: { id: submission.id },
      data: {
        currentStageId: toStage.id,
        stageChangedAt: now,
        ...(input.clientFeedback !== undefined
          ? { clientFeedback: input.clientFeedback }
          : {}),
        // Cleared when the candidate stops being rejected, so a profile that
        // was revived does not keep explaining a rejection that was undone.
        rejectedReason: toStage.isRejected
          ? (input.rejectedReason ?? null)
          : null,
        ...(toStage.isPlaced && input.placement?.joiningDate
          ? { joiningDate: input.placement.joiningDate }
          : {}),
      },
    })

    await tx.candidateStageHistory.create({
      data: {
        submissionId: submission.id,
        fromStageId: submission.currentStageId,
        toStageId: toStage.id,
        changedById: input.actorId,
        changedAt: now,
        note: input.note,
      },
    })

    // The timeline lives on the requirement, which is where the board is and
    // where someone catching up on this role will look. `Activity` has no
    // submission column, and adding one would put per-candidate chatter into
    // the same list without a way to filter it back out.
    await tx.activity.create({
      data: {
        type: 'STAGE_CHANGE',
        subject: `${submission.candidate.fullName}: ${submission.currentStage.name} → ${toStage.name}`,
        notes: input.note,
        activityDate: now,
        userId: input.actorId,
        requirementId: submission.requirementId,
      },
    })

    await recordAudit({
      entityType: 'SUBMISSION',
      entityId: submission.id,
      action: 'STAGE_CHANGE',
      fieldName: 'currentStageId',
      oldValue: submission.currentStage.name,
      newValue: toStage.name,
      userId: input.actorId,
    })

    return {
      ok: true as const,
      candidateName: submission.candidate.fullName,
      stageName: toStage.name,
      placed: toStage.isPlaced,
    }
  })
}

/**
 * The four writes that make a placement, or the reason it cannot happen.
 *
 * Returns `null` on success so the caller can carry on with the stage move —
 * everything here has to be true *before* the submission is marked placed.
 */
async function recordPlacement(
  tx: TransactionClient,
  input: {
    submission: {
      id: string
      candidateId: string
      requirementId: string
      requirement: {
        id: string
        requirementCode: string
        leadId: string
        openings: number
        positionsFilled: number
        currentStageId: string | null
        stageChangedAt: Date
      }
    }
    placement: PlacementInput | undefined
    actorId: string
    at: Date
  },
): Promise<{ ok: false; message: string; field?: string } | null> {
  const { submission } = input
  const requirement = submission.requirement

  const joiningDate = input.placement?.joiningDate
  if (!joiningDate) {
    return {
      ok: false,
      message: 'Enter the joining date.',
      field: 'joiningDate',
    }
  }

  // `Placement.placementValue` is not nullable, and for good reason: a
  // placement worth nothing is indistinguishable from a placement nobody
  // valued, and Won Revenue would silently under-report the second kind.
  const placementValue = input.placement?.placementValue
  if (placementValue === null || placementValue === undefined) {
    return {
      ok: false,
      message: 'Enter the value booked against this placement.',
      field: 'placementValue',
    }
  }

  // The winning stage is looked up *before* anything is written, because every
  // side effect below depends on it. Written the other way round — placement
  // row first, stage lookup after — an empty or entirely retired stage list
  // left a placement and an incremented `positionsFilled` behind while the
  // requirement stayed OPEN and the lead was never re-derived: booked revenue
  // against a requirement nothing said was filled.
  //
  // `orderBy` because `findFirst` without one is not deterministic, and the
  // stage editor does not forbid a second winning entry the way the pipeline
  // stage editor does for a vertical.
  const winning = await tx.requirementStage.findFirst({
    where: { isWon: true, isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true, isWon: true, isLost: true },
  })

  if (!winning) {
    return {
      ok: false,
      message:
        'There is no active Placement stage in the requirement stage list, so this join cannot be recorded. An administrator can restore it in Master Data.',
      field: 'toStageId',
    }
  }

  // Claiming an opening is a conditional update rather than the read-then-check
  // it used to be. Two recruiters marking different candidates as joined on a
  // one-opening requirement at the same moment both passed the old check —
  // READ COMMITTED lets each read `positionsFilled` before the other's write —
  // and produced two placements against one opening, a Fill Rate over 100% and
  // revenue booked twice. Comparing the column against `openings` inside the
  // UPDATE makes them serialise on the row lock instead, and the loser gets the
  // message below. This is the same reasoning `src/lib/codes.ts` gives for
  // issuing codes with a single `UPDATE … RETURNING`.
  const claimed = await tx.requirement.updateMany({
    where: {
      id: requirement.id,
      positionsFilled: { lt: tx.requirement.fields.openings },
    },
    data: { positionsFilled: { increment: 1 } },
  })

  if (claimed.count === 0) {
    return {
      ok: false,
      message: `All ${requirement.openings} opening${requirement.openings === 1 ? '' : 's'} on ${requirement.requirementCode} are already filled. Raise the opening count on the requirement first.`,
      field: 'toStageId',
    }
  }

  // Re-read rather than assuming `positionsFilled + 1`: under the contention
  // the conditional update exists to handle, the value this transaction landed
  // on is not necessarily the one it read a moment ago.
  const claimedRequirement = await tx.requirement.findUniqueOrThrow({
    where: { id: requirement.id },
    select: { positionsFilled: true, openings: true },
  })

  const filled = claimedRequirement.positionsFilled

  await tx.placement.create({
    data: {
      submissionId: submission.id,
      requirementId: requirement.id,
      leadId: requirement.leadId,
      candidateId: submission.candidateId,
      joiningDate,
      placementValue,
      salary: input.placement?.salary ?? null,
      billRate: input.placement?.billRate ?? null,
      marginPerMonth: input.placement?.marginPerMonth ?? null,
      guaranteePeriodDays: input.placement?.guaranteePeriodDays ?? null,
    },
  })

  // Already at the winning stage when the second of three openings is filled —
  // `applyRequirementStage` would write a pointless history row, and the status
  // still has to be re-derived from the new `positionsFilled`.
  if (requirement.currentStageId === winning.id) {
    const complete = filled >= claimedRequirement.openings

    await tx.requirement.update({
      where: { id: requirement.id },
      data: {
        status: complete ? 'FILLED' : 'PARTIALLY_FILLED',
        closedAt: complete ? input.at : null,
      },
    })

    // A no-op whenever the lead is already WON, which it will be — a
    // requirement cannot be at its winning stage without an earlier placement.
    // Called anyway so that this branch cannot be the one path where a status
    // change fails to reach the lead.
    await syncStaffingLeadOutcome(tx, {
      leadId: requirement.leadId,
      actorId: input.actorId,
      at: input.at,
    })

    return null
  }

  const fromStage = requirement.currentStageId
    ? await tx.requirementStage.findUnique({
        where: { id: requirement.currentStageId },
        select: { id: true, name: true },
      })
    : null

  await applyRequirementStage(tx, {
    requirement: { ...requirement, positionsFilled: filled },
    fromStage,
    toStage: winning,
    actorId: input.actorId,
    note: 'A candidate joined',
    at: input.at,
  })

  return null
}

/**
 * The stage a new submission starts at.
 *
 * Read before the insert rather than patched in after it, because
 * `CandidateSubmission.currentStageId` is not nullable — a submission with no
 * stage is not a state the schema allows, which is the right constraint: a
 * profile that is in no stage is a profile nobody is working.
 *
 * Returns `null` when the candidate stage list is empty or entirely retired.
 * The caller refuses the submission in that case, unlike the two levels above:
 * a requirement with no stage is still a client asking for people, but a
 * submission with no stage cannot be created at all.
 */
export function firstSubmissionStage(tx: TransactionClient) {
  return tx.candidateStage.findFirst({
    where: { isActive: true, isPlaced: false, isRejected: false },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true },
  })
}

/**
 * The history row for a submission that has just been created.
 *
 * Written as a transition rather than left implicit so that Profiles Shared and
 * every other `subReached` metric counts the first stage the same way it counts
 * the rest — without it, the first step of the candidate funnel would be the
 * one step nothing is ever recorded against.
 */
export async function recordInitialSubmissionStage(
  tx: TransactionClient,
  input: {
    submissionId: string
    stageId: string
    actorId: string
    at: Date
  },
): Promise<void> {
  await tx.candidateStageHistory.create({
    data: {
      submissionId: input.submissionId,
      fromStageId: null,
      toStageId: input.stageId,
      changedById: input.actorId,
      changedAt: input.at,
      note: 'Candidate submitted',
    },
  })
}
