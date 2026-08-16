import 'server-only'

import { auditedTransaction, type TransactionClient } from '@/lib/db'
import { recordAudit } from '@/lib/audit/record'
import type { CommonStage, LeadStatus } from '@/generated/prisma/enums'

/**
 * The stage engine.
 *
 * One entry point for every stage change in the application, because five
 * things have to happen together or the numbers stop agreeing with each other:
 *
 *  1. `Lead.currentStageId` moves.
 *  2. `Lead.commonStage` is rewritten from the new stage's mapping (decision
 *     D5). It is never editable by hand — the whole point of the derived bucket
 *     is that the cross-vertical chart cannot disagree with the vertical's own
 *     stage list.
 *  3. `Lead.status` follows the stage's `isWon` / `isLost` flags, so "how many
 *     did we win" never depends on someone remembering to set a second field.
 *  4. A `LeadStageHistory` row is written. That table, not `currentStageId`, is
 *     the source of truth for every conversion percentage and for Pipeline
 *     Aging (decision D12) — a lead that passed through Negotiation on its way
 *     to Won has to keep saying so.
 *  5. An `Activity` row appears on the timeline, so the person opening the lead
 *     sees the move in the same list as the calls and emails around it.
 *
 * All five in one transaction. A stage change that moved the pointer but lost
 * its history entry would silently under-count every funnel it appears in, and
 * nothing downstream would flag it.
 */

export type StageChangeResult =
  | { ok: true; leadCode: string; stageName: string }
  | { ok: false; message: string; field?: string }

export type StageOption = {
  id: string
  name: string
  sortOrder: number
  commonStage: CommonStage
  isWon: boolean
  isLost: boolean
}

function statusFor(stage: { isWon: boolean; isLost: boolean }): LeadStatus {
  if (stage.isWon) return 'WON'
  if (stage.isLost) return 'LOST'
  return 'OPEN'
}

/**
 * The five writes, without the validation.
 *
 * Split out in Phase 4 so a staffing lead's *derived* outcome (decision D8) can
 * move its stage through exactly this code rather than a second implementation
 * that would drift. The validation above it — reason on a backward move, a lost
 * reason on a loss — belongs to a person typing a change, and none of it
 * applies when the move is a consequence of a requirement being filled.
 *
 * Callers are responsible for having checked that `toStage` belongs to the
 * lead's vertical.
 */
export async function applyLeadStage(
  tx: TransactionClient,
  input: {
    lead: {
      id: string
      leadCode: string
      currentStageId: string | null
      stageChangedAt: Date
    }
    fromStage: { id: string; name: string; commonStage: CommonStage } | null
    toStage: {
      id: string
      name: string
      commonStage: CommonStage
      isWon: boolean
      isLost: boolean
    }
    actorId: string
    note: string | null
    lostReasonId?: string | null
    lostNotes?: string | null
    dealValue?: number | null
    at?: Date
  },
): Promise<LeadStatus> {
  const { lead, fromStage, toStage } = input
  const now = input.at ?? new Date()
  const status = statusFor(toStage)

  await tx.lead.update({
    where: { id: lead.id },
    data: {
      currentStageId: toStage.id,
      commonStage: toStage.commonStage,
      status,
      stageChangedAt: now,
      // Closing stamps the date; reopening clears it, so "closed in August"
      // never counts a lead that went back into the pipeline in September.
      closedAt: status === 'OPEN' ? null : now,
      // Lost detail belongs to the outcome, so it is cleared when the lead
      // stops being lost rather than lingering on a reopened deal.
      lostReasonId: toStage.isLost ? (input.lostReasonId ?? null) : null,
      lostNotes: toStage.isLost ? (input.lostNotes ?? null) : null,
      ...(input.dealValue !== undefined && input.dealValue !== null
        ? { dealValue: input.dealValue }
        : {}),
    },
  })

  await tx.leadStageHistory.create({
    data: {
      leadId: lead.id,
      fromStageId: fromStage?.id ?? null,
      toStageId: toStage.id,
      fromCommonStage: fromStage?.commonStage ?? null,
      toCommonStage: toStage.commonStage,
      changedById: input.actorId,
      changedAt: now,
      // Precomputed so the aging report never has to reconstruct it by
      // walking the whole history of every lead.
      hoursInPreviousStage: Math.max(
        0,
        Math.round((now.getTime() - lead.stageChangedAt.getTime()) / 3_600_000),
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
      leadId: lead.id,
    },
  })

  // The ORM writer sees this as "Lead.currentStageId changed" and cannot tell
  // it apart from an edit. `AuditAction` has names for the three events that
  // matter to a compliance reader, so say which one this was.
  await recordAudit({
    entityType: 'LEAD',
    entityId: lead.id,
    action: status === 'WON' ? 'WON' : status === 'LOST' ? 'LOST' : 'STAGE_CHANGE',
    fieldName: 'currentStageId',
    oldValue: fromStage?.name ?? null,
    newValue: toStage.name,
    userId: input.actorId,
  })

  return status
}

/**
 * Move a lead to a stage.
 *
 * `reason` is required for a backward move and optional otherwise — open
 * question Q2's accepted default. The asymmetry is deliberate: moving forward
 * is the process working, and moving backward is a judgement someone downstream
 * will want explained, because "ever reached" metrics (D12) read differently
 * when a lead revisits a stage it already passed.
 */
export async function changeLeadStage(input: {
  leadId: string
  toStageId: string
  actorId: string
  reason: string | null
  /** Required when moving to a losing stage. */
  lostReasonId?: string | null
  lostNotes?: string | null
  /** Agreed value, accepted alongside a win. */
  dealValue?: number | null
}): Promise<StageChangeResult> {
  return auditedTransaction(async (tx) => {
    const lead = await tx.lead.findUnique({
      where: { id: input.leadId },
      select: {
        id: true,
        leadCode: true,
        verticalId: true,
        currentStageId: true,
        commonStage: true,
        status: true,
        stageChangedAt: true,
        dealValue: true,
      },
    })

    if (!lead) return { ok: false as const, message: 'That lead no longer exists.' }

    const toStage = await tx.pipelineStage.findUnique({
      where: { id: input.toStageId },
      select: {
        id: true,
        name: true,
        verticalId: true,
        commonStage: true,
        sortOrder: true,
        isWon: true,
        isLost: true,
        isActive: true,
      },
    })

    // A stage from another vertical would put the lead in a funnel its own
    // stage list does not contain, and the vertical funnel report would then
    // show a lead sitting at a stage that is not on its chart.
    if (!toStage || toStage.verticalId !== lead.verticalId) {
      return {
        ok: false as const,
        message: 'That stage does not belong to this lead’s vertical.',
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

    if (lead.currentStageId === toStage.id) {
      return {
        ok: false as const,
        message: `This lead is already at ${toStage.name}.`,
        field: 'toStageId',
      }
    }

    const fromStage = lead.currentStageId
      ? await tx.pipelineStage.findUnique({
          where: { id: lead.currentStageId },
          select: { id: true, name: true, sortOrder: true, commonStage: true },
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

    // A lost lead without a reason is a lost lead nobody can learn from, and
    // the Won/Lost report's lost-reason breakdown is one of the eleven reports
    // this is all for.
    if (toStage.isLost && !input.lostReasonId) {
      return {
        ok: false as const,
        message: 'Choose why this lead was lost.',
        field: 'lostReasonId',
      }
    }

    if (input.lostReasonId) {
      const lostReason = await tx.lostReason.findUnique({
        where: { id: input.lostReasonId },
        select: { isActive: true, verticalId: true },
      })

      // Reasons are either global (`verticalId` null) or belong to one vertical.
      if (
        !lostReason ||
        !lostReason.isActive ||
        (lostReason.verticalId !== null &&
          lostReason.verticalId !== lead.verticalId)
      ) {
        return {
          ok: false as const,
          message: 'That lost reason is not available for this vertical.',
          field: 'lostReasonId',
        }
      }
    }

    await applyLeadStage(tx, {
      lead,
      fromStage,
      toStage,
      actorId: input.actorId,
      note: input.reason,
      lostReasonId: input.lostReasonId,
      lostNotes: input.lostNotes,
      dealValue: input.dealValue,
    })

    return {
      ok: true as const,
      leadCode: lead.leadCode,
      stageName: toStage.name,
    }
  })
}

/**
 * Put a newly created lead at the first stage of its vertical.
 *
 * Runs inside the caller's transaction — the lead, its code and its first
 * history row are one atomic act. It writes history like any other transition
 * so that a lead's very first stage entry is counted by the same "ever reached"
 * query as the rest (decision D12); without it, every funnel would under-count
 * its own first stage.
 */
export async function setInitialStage(
  tx: TransactionClient,
  input: { leadId: string; verticalId: string; actorId: string; at: Date },
): Promise<StageOption | null> {
  const first = await tx.pipelineStage.findFirst({
    where: {
      verticalId: input.verticalId,
      isActive: true,
      isWon: false,
      isLost: false,
    },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      name: true,
      sortOrder: true,
      commonStage: true,
      isWon: true,
      isLost: true,
    },
  })

  // A vertical whose stage list is empty or entirely retired. The lead is still
  // worth creating — it lands with no stage and `commonStage` NEW, and an
  // administrator fixing the stage list in /admin/master/stages makes it
  // advanceable. Refusing the lead instead would lose the enquiry.
  if (!first) return null

  await tx.lead.update({
    where: { id: input.leadId },
    data: {
      currentStageId: first.id,
      commonStage: first.commonStage,
      stageChangedAt: input.at,
    },
  })

  await tx.leadStageHistory.create({
    data: {
      leadId: input.leadId,
      fromStageId: null,
      toStageId: first.id,
      fromCommonStage: null,
      toCommonStage: first.commonStage,
      changedById: input.actorId,
      changedAt: input.at,
      hoursInPreviousStage: null,
      note: 'Lead created',
    },
  })

  return first
}
