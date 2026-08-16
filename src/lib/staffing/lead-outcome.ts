import 'server-only'

import { applyLeadStage } from '@/lib/leads/stage'
import type { TransactionClient } from '@/lib/db'
import type { LeadStatus, RequirementStatus } from '@/generated/prisma/enums'

/**
 * A staffing lead's outcome is *derived*, never typed (decision D8).
 *
 * docs/01-data-model.md §2 states the rule: **WON once at least one requirement
 * is filled, LOST when all of them are lost, otherwise OPEN**. That is the whole
 * reason `Requirement` carries its own `status` and `lostReasonId` — one client
 * engagement produces several requirements, and "did we win the client" is not
 * the same question as "did we fill the Java role".
 *
 * Two consequences worth being explicit about, because both are places where a
 * plausible alternative would quietly break a report:
 *
 *  - **The lead's pipeline stage moves too, not just its status.** The Staffing
 *    stage list has Won and Lost entries mapped to the `WON` / `LOST` common
 *    stages (docs/02 §3.8), and decision D5 only holds if `commonStage`,
 *    `status` and `currentStageId` say the same thing. A lead whose status flips
 *    to WON while its stage stayed at Active Account would appear as won in the
 *    KPI row and as open in the very chart beside it.
 *  - **The lead still counts once.** docs/02 §5 is emphatic: a staffing lead
 *    with two filled requirements is one won lead, not two. Requirement-level
 *    outcomes are reported separately, and nothing here adds to the lead counts.
 *
 * `CANCELLED` is deliberately not `LOST`. A requirement the client withdrew is
 * not a deal lost to a competitor, and folding the two together would put
 * withdrawals into the lost-reason breakdown with no reason attached. A lead
 * whose every requirement was cancelled therefore stays OPEN — nobody has said
 * what happened to the account, and inventing an answer is worse than leaving
 * the question visible.
 */

/** The derived status, from the requirement statuses alone. */
export function deriveLeadStatus(
  statuses: RequirementStatus[],
): LeadStatus {
  if (statuses.length === 0) return 'OPEN'

  // One filled opening is a won client engagement, whatever happened to the
  // other requirements. PARTIALLY_FILLED means at least one placement exists.
  if (statuses.some((s) => s === 'FILLED' || s === 'PARTIALLY_FILLED')) {
    return 'WON'
  }

  const allClosed = statuses.every((s) => s === 'LOST' || s === 'CANCELLED')
  const anyLost = statuses.some((s) => s === 'LOST')

  return allClosed && anyLost ? 'LOST' : 'OPEN'
}

/**
 * Recompute a staffing lead's outcome and move its stage to match.
 *
 * Runs inside the caller's transaction, so a requirement closing and the lead
 * following it are one atomic act. A no-op when nothing has changed — this is
 * called after every requirement transition and most of them do not flip the
 * lead.
 */
export async function syncStaffingLeadOutcome(
  tx: TransactionClient,
  input: { leadId: string; actorId: string; at?: Date },
): Promise<LeadStatus | null> {
  const lead = await tx.lead.findUnique({
    where: { id: input.leadId },
    select: {
      id: true,
      leadCode: true,
      verticalId: true,
      status: true,
      currentStageId: true,
      stageChangedAt: true,
    },
  })

  if (!lead) return null

  const requirements = await tx.requirement.findMany({
    where: { leadId: lead.id, isDeleted: false },
    select: { status: true },
  })

  const target = deriveLeadStatus(requirements.map((row) => row.status))
  if (target === lead.status) return target

  // Every stage of the vertical, so the outcome stages and the fallback can be
  // found in one read.
  const stages = await tx.pipelineStage.findMany({
    where: { verticalId: lead.verticalId },
    select: {
      id: true,
      name: true,
      sortOrder: true,
      commonStage: true,
      isWon: true,
      isLost: true,
      isActive: true,
    },
    orderBy: { sortOrder: 'asc' },
  })

  const toStage =
    target === 'WON'
      ? stages.find((stage) => stage.isWon)
      : target === 'LOST'
        ? stages.find((stage) => stage.isLost)
        : await reopenStage(tx, lead.id, stages)

  // A Staffing vertical whose stage list has no winning entry. The status is
  // worth nothing on its own — `Lead.status` is written by the stage engine and
  // only by the stage engine, so that the three fields cannot disagree — so
  // this returns without changing anything rather than writing half the truth.
  // Fixing the stage list in /admin/master/stages and closing the next
  // requirement brings the lead across.
  if (!toStage) return lead.status

  // The stage is already right but the status disagrees with it. Nothing in
  // this module can produce that — `applyLeadStage` always writes both — but a
  // lead that reached the Won stage some other way and then had its
  // requirements change would sit with a stage and a status telling different
  // stories, and this function is the one thing that would have noticed. Bring
  // the status into line rather than returning as if it were already correct.
  // No history row: nothing moved, so a transition would be a fiction.
  if (toStage.id === lead.currentStageId) {
    const now = input.at ?? new Date()

    await tx.lead.update({
      where: { id: lead.id },
      data: {
        status: target,
        closedAt: target === 'OPEN' ? null : now,
      },
    })

    return target
  }

  const fromStage = lead.currentStageId
    ? (stages.find((stage) => stage.id === lead.currentStageId) ?? null)
    : null

  await applyLeadStage(tx, {
    lead,
    fromStage,
    toStage,
    actorId: input.actorId,
    // Named as derived on the timeline and in stage history. Someone reading
    // the lead a month later needs to know nobody typed this.
    note:
      target === 'WON'
        ? 'Derived: a requirement was filled'
        : target === 'LOST'
          ? 'Derived: every requirement was lost'
          : 'Derived: a requirement reopened',
    // No lost reason. The reason lives on each requirement, where it was
    // actually chosen; copying one of several up to the lead would name one
    // requirement's reason as the account's.
    lostReasonId: null,
    at: input.at,
  })

  return target
}

/**
 * Where a reopened lead goes back to.
 *
 * The most recent stage it was at before the outcome, read from its own
 * history. Falling back to the first active non-outcome stage covers a lead
 * whose history is only the outcome — which cannot happen through the UI, but
 * a lead stuck on Won with nowhere to return to would be unworkable.
 */
async function reopenStage<
  T extends { id: string; isWon: boolean; isLost: boolean; isActive: boolean },
>(tx: TransactionClient, leadId: string, stages: T[]): Promise<T | undefined> {
  const open = new Set(
    stages.filter((stage) => !stage.isWon && !stage.isLost).map((s) => s.id),
  )

  const previous = await tx.leadStageHistory.findFirst({
    where: { leadId, toStageId: { in: [...open] } },
    orderBy: { changedAt: 'desc' },
    select: { toStageId: true },
  })

  // `isActive` on both halves. Without it on the first, a lead could be
  // reopened onto a stage an administrator has since retired — one the stage
  // control would then refuse to move it off, because retired stages are not
  // offered as destinations either.
  return (
    stages.find(
      (stage) => stage.id === previous?.toStageId && stage.isActive,
    ) ?? stages.find((stage) => open.has(stage.id) && stage.isActive)
  )
}
