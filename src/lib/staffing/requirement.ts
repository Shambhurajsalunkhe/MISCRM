import 'server-only'

import { auditedTransaction, type TransactionClient } from '@/lib/db'
import { recordAudit } from '@/lib/audit/record'
import { syncStaffingLeadOutcome } from '@/lib/staffing/lead-outcome'
import type { RequirementStatus } from '@/generated/prisma/enums'

/**
 * The requirement stage engine — `src/lib/leads/stage.ts` for the level below
 * the lead.
 *
 * Same shape and the same reasoning: one entry point, because the pointer, the
 * status, the history row, the timeline entry and the audit line have to move
 * together or the staffing report stops agreeing with the requirement list.
 * `RequirementStageHistory`, not `currentStageId`, is what
 * docs/02-funnels-and-metrics.md §4.7 counts (decision D12).
 *
 * Two differences from the lead engine, both from decision D8:
 *
 *  - **Status is not a straight read of the stage's flags.** A requirement at
 *    the winning stage is `FILLED` only when every opening has a placement
 *    against it; otherwise it is `PARTIALLY_FILLED` and still live for the rest.
 *    That distinction is the whole reason Fill Rate exists as a separate metric
 *    from Requirement Conversion.
 *  - **Closing a requirement re-derives its lead's outcome.** The lead's own
 *    Won/Lost is a consequence of what happened here, so every transition ends
 *    in `syncStaffingLeadOutcome`.
 *
 * Requirement stages are global rather than per-vertical — one `RequirementStage`
 * list serves every staffing lead — so there is no equivalent of the lead
 * engine's "this stage belongs to another vertical" check.
 */

export type RequirementStageResult =
  | { ok: true; requirementCode: string; stageName: string; status: RequirementStatus }
  | { ok: false; message: string; field?: string }

type StageFlags = { isWon: boolean; isLost: boolean }

/**
 * The status a requirement holds at a given stage.
 *
 * `ON_HOLD` and `CANCELLED` are not produced here: they are deliberate
 * interruptions rather than positions in the pipeline, set through
 * `setRequirementStatus` and cleared by the next stage move — because moving a
 * requirement forward *is* the statement that work resumed.
 */
export function requirementStatusFor(
  stage: StageFlags,
  openings: number,
  positionsFilled: number,
): RequirementStatus {
  if (stage.isLost) return 'LOST'
  if (!stage.isWon) return 'OPEN'
  return positionsFilled >= openings ? 'FILLED' : 'PARTIALLY_FILLED'
}

/**
 * The writes, without the validation — the counterpart of `applyLeadStage`.
 *
 * Exported because a placement moves its requirement to the winning stage
 * automatically (see `src/lib/staffing/submission.ts`), and that path has
 * already established everything the validation below would re-check.
 */
export async function applyRequirementStage(
  tx: TransactionClient,
  input: {
    requirement: {
      id: string
      requirementCode: string
      leadId: string
      openings: number
      positionsFilled: number
      currentStageId: string | null
      stageChangedAt: Date
    }
    fromStage: { id: string; name: string } | null
    toStage: { id: string; name: string; isWon: boolean; isLost: boolean }
    actorId: string
    note: string | null
    lostReasonId?: string | null
    at?: Date
  },
): Promise<RequirementStatus> {
  const { requirement, fromStage, toStage } = input
  const now = input.at ?? new Date()

  const status = requirementStatusFor(
    toStage,
    requirement.openings,
    requirement.positionsFilled,
  )

  const closed = status === 'FILLED' || status === 'LOST'

  await tx.requirement.update({
    where: { id: requirement.id },
    data: {
      currentStageId: toStage.id,
      status,
      stageChangedAt: now,
      // `PARTIALLY_FILLED` is not closed: openings remain, and dating it as
      // closed would end the requirement's ageing while it is still being
      // worked.
      closedAt: closed ? now : null,
      lostReasonId: toStage.isLost ? (input.lostReasonId ?? null) : null,
    },
  })

  await tx.requirementStageHistory.create({
    data: {
      requirementId: requirement.id,
      fromStageId: fromStage?.id ?? null,
      toStageId: toStage.id,
      changedById: input.actorId,
      changedAt: now,
      hoursInPreviousStage: Math.max(
        0,
        Math.round(
          (now.getTime() - requirement.stageChangedAt.getTime()) / 3_600_000,
        ),
      ),
      note: input.note,
    },
  })

  await tx.activity.create({
    data: {
      type: 'STAGE_CHANGE',
      subject: fromStage
        ? `Stage: ${fromStage.name} → ${toStage.name}`
        : `Stage set to ${toStage.name}`,
      notes: input.note,
      activityDate: now,
      userId: input.actorId,
      requirementId: requirement.id,
    },
  })

  await recordAudit({
    entityType: 'REQUIREMENT',
    entityId: requirement.id,
    action: toStage.isWon ? 'WON' : toStage.isLost ? 'LOST' : 'STAGE_CHANGE',
    fieldName: 'currentStageId',
    oldValue: fromStage?.name ?? null,
    newValue: toStage.name,
    userId: input.actorId,
  })

  await syncStaffingLeadOutcome(tx, {
    leadId: requirement.leadId,
    actorId: input.actorId,
    at: now,
  })

  return status
}

/**
 * Move a requirement to a stage, as a person.
 *
 * `reason` is required on a backward move for the same reason it is on a lead
 * (open question Q2): "ever reached" metrics read differently when a record
 * revisits a stage it already passed.
 */
export async function changeRequirementStage(input: {
  requirementId: string
  toStageId: string
  actorId: string
  reason: string | null
  lostReasonId?: string | null
}): Promise<RequirementStageResult> {
  return auditedTransaction(async (tx) => {
    const requirement = await tx.requirement.findUnique({
      where: { id: input.requirementId },
      select: {
        id: true,
        requirementCode: true,
        leadId: true,
        openings: true,
        positionsFilled: true,
        currentStageId: true,
        stageChangedAt: true,
        lead: { select: { verticalId: true } },
      },
    })

    if (!requirement) {
      return { ok: false as const, message: 'That requirement no longer exists.' }
    }

    const toStage = await tx.requirementStage.findUnique({
      where: { id: input.toStageId },
      select: {
        id: true,
        name: true,
        sortOrder: true,
        isWon: true,
        isLost: true,
        isActive: true,
      },
    })

    if (!toStage) {
      return {
        ok: false as const,
        message: 'That stage does not exist.',
        field: 'toStageId',
      }
    }

    if (!toStage.isActive) {
      return {
        ok: false as const,
        message: 'That stage has been retired. Choose another.',
        field: 'toStageId',
      }
    }

    if (requirement.currentStageId === toStage.id) {
      return {
        ok: false as const,
        message: `This requirement is already at ${toStage.name}.`,
        field: 'toStageId',
      }
    }

    // A requirement reaches the winning stage because somebody joined, not the
    // other way round — decision D8 makes `Placement` the revenue unit, and a
    // requirement marked Placement with no placement row against it would count
    // in Requirements Filled while contributing nothing to Won Revenue. The
    // supported route is marking the submission Joined on the board, which
    // creates the placement and moves the requirement here itself.
    if (toStage.isWon && requirement.positionsFilled === 0) {
      return {
        ok: false as const,
        message:
          'Mark the candidate as joined on the submission board instead — that records the placement and closes the requirement with it.',
        field: 'toStageId',
      }
    }

    const fromStage = requirement.currentStageId
      ? await tx.requirementStage.findUnique({
          where: { id: requirement.currentStageId },
          select: { id: true, name: true, sortOrder: true },
        })
      : null

    const movingBackwards = fromStage
      ? toStage.sortOrder < fromStage.sortOrder
      : false

    if (movingBackwards && !input.reason) {
      return {
        ok: false as const,
        message: `Moving back from ${fromStage?.name} to ${toStage.name} needs a reason.`,
        field: 'reason',
      }
    }

    if (toStage.isLost && !input.lostReasonId) {
      return {
        ok: false as const,
        message: 'Choose why this requirement was lost.',
        field: 'lostReasonId',
      }
    }

    if (input.lostReasonId) {
      const lostReason = await tx.lostReason.findUnique({
        where: { id: input.lostReasonId },
        select: { isActive: true, verticalId: true },
      })

      // Reasons are either global (`verticalId` null) or belong to one
      // vertical — here, the vertical of the requirement's lead.
      if (
        !lostReason ||
        !lostReason.isActive ||
        (lostReason.verticalId !== null &&
          lostReason.verticalId !== requirement.lead.verticalId)
      ) {
        return {
          ok: false as const,
          message: 'That lost reason is not available for this vertical.',
          field: 'lostReasonId',
        }
      }
    }

    const status = await applyRequirementStage(tx, {
      requirement,
      fromStage,
      toStage,
      actorId: input.actorId,
      note: input.reason,
      lostReasonId: input.lostReasonId,
    })

    return {
      ok: true as const,
      requirementCode: requirement.requirementCode,
      stageName: toStage.name,
      status,
    }
  })
}

/**
 * Put a newly created requirement at the first stage of the list.
 *
 * Runs inside the caller's transaction and writes a history row, so that a
 * requirement's very first stage entry is counted by the same "ever reached"
 * query as the rest — without it, Requirements Received and the first funnel
 * step would disagree for every requirement ever created.
 */
export async function setInitialRequirementStage(
  tx: TransactionClient,
  input: { requirementId: string; actorId: string; at: Date },
): Promise<{ id: string; name: string } | null> {
  const first = await tx.requirementStage.findFirst({
    where: { isActive: true, isWon: false, isLost: false },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true },
  })

  // An entirely retired stage list. The requirement is still worth creating —
  // it lands with no stage, and fixing the list in /admin/master/stages makes it
  // advanceable. Refusing it instead would lose the client's request.
  if (!first) return null

  await tx.requirement.update({
    where: { id: input.requirementId },
    data: { currentStageId: first.id, stageChangedAt: input.at },
  })

  await tx.requirementStageHistory.create({
    data: {
      requirementId: input.requirementId,
      fromStageId: null,
      toStageId: first.id,
      changedById: input.actorId,
      changedAt: input.at,
      hoursInPreviousStage: null,
      note: 'Requirement received',
    },
  })

  return first
}

/**
 * Put a requirement on hold, or cancel it.
 *
 * The two statuses that are not positions in the pipeline. A hold says the
 * client paused; a cancellation says they withdrew — which is not the same as
 * losing, and is why `deriveLeadStatus` treats the two differently.
 *
 * The stage is left where it is on purpose. A requirement that comes off hold
 * resumes from where it stopped, and the next stage move re-derives the status
 * from the stage, which is the statement that work restarted.
 */
export async function setRequirementStatus(input: {
  requirementId: string
  status: Extract<RequirementStatus, 'ON_HOLD' | 'CANCELLED' | 'OPEN'>
  actorId: string
  reason: string | null
}): Promise<RequirementStageResult> {
  return auditedTransaction(async (tx) => {
    const requirement = await tx.requirement.findUnique({
      where: { id: input.requirementId },
      select: {
        id: true,
        requirementCode: true,
        leadId: true,
        status: true,
        openings: true,
        positionsFilled: true,
        currentStageId: true,
        currentStage: { select: { name: true, isWon: true, isLost: true } },
      },
    })

    if (!requirement) {
      return { ok: false as const, message: 'That requirement no longer exists.' }
    }

    // Reopening a closed requirement is a stage move, not a status change: the
    // stage is what everything else is derived from, so letting a status flip
    // reopen a filled requirement would leave it at Placement and OPEN at once.
    if (
      requirement.currentStage?.isWon ||
      requirement.currentStage?.isLost
    ) {
      return {
        ok: false as const,
        message: `${requirement.requirementCode} is closed at ${requirement.currentStage.name}. Move its stage to reopen it.`,
      }
    }

    if (requirement.status === input.status) {
      return {
        ok: false as const,
        message: `${requirement.requirementCode} is already ${input.status === 'ON_HOLD' ? 'on hold' : input.status.toLowerCase()}.`,
      }
    }

    const now = new Date()

    await tx.requirement.update({
      where: { id: requirement.id },
      data: {
        status: input.status,
        closedAt: input.status === 'CANCELLED' ? now : null,
      },
    })

    await tx.activity.create({
      data: {
        type: 'NOTE',
        subject:
          input.status === 'ON_HOLD'
            ? 'Put on hold'
            : input.status === 'CANCELLED'
              ? 'Cancelled'
              : 'Resumed',
        notes: input.reason,
        activityDate: now,
        userId: input.actorId,
        requirementId: requirement.id,
      },
    })

    await recordAudit({
      entityType: 'REQUIREMENT',
      entityId: requirement.id,
      action: 'UPDATE',
      fieldName: 'status',
      oldValue: requirement.status,
      newValue: input.status,
      userId: input.actorId,
    })

    // A cancellation changes which requirements are still live, which is an
    // input to the lead's derived outcome.
    await syncStaffingLeadOutcome(tx, {
      leadId: requirement.leadId,
      actorId: input.actorId,
      at: now,
    })

    return {
      ok: true as const,
      requirementCode: requirement.requirementCode,
      stageName: requirement.currentStage?.name ?? 'Not set',
      status: input.status,
    }
  })
}
