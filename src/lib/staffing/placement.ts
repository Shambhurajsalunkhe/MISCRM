import 'server-only'

import { auditedTransaction } from '@/lib/db'
import { recordAudit } from '@/lib/audit/record'
import { requirementStatusFor } from '@/lib/staffing/requirement'
import { syncStaffingLeadOutcome } from '@/lib/staffing/lead-outcome'

/**
 * Reversing a placement — the question Phase 4 left to Phase 5.
 *
 * A candidate who withdraws a week after joining, or who is let go inside the
 * guarantee period, is a real event with real consequences: the opening is open
 * again, the requirement may no longer be filled, the lead's derived outcome may
 * no longer be Won, and the revenue booked against the placement stops being
 * revenue. Phase 4 refused to model it and said so on screen, because deleting a
 * `Placement` from a stage dropdown would have moved a dashboard number with
 * nothing to explain it.
 *
 * What Phase 5 builds is the reversal the plan asked for: **a record, not a
 * delete**. The row stays exactly where it was, gains `reversedAt`, a reason and
 * the person who did it, and every revenue query filters `reversedAt: null`. So
 * Won Revenue drops by the right amount, and the reason it dropped is a row
 * anybody can open — which is the whole difference between a correction and a
 * number that changed overnight.
 *
 * Three things follow from that shape and are worth naming:
 *
 *  - **Invoices come first.** A reversal is refused while any non-cancelled
 *    invoice stands against the placement. Crediting a client is a decision with
 *    a paper trail of its own, and this function silently un-booking revenue
 *    that has already been billed — possibly paid — would leave Collected
 *    Revenue pointing at work the system says never happened.
 *  - **The opening comes back.** `positionsFilled` goes down by one and the
 *    requirement's status is re-derived, so a one-opening role returns from
 *    FILLED to whatever its stage says it is. It stays at the winning stage
 *    rather than being walked backwards: the placement did happen, and the
 *    history row recording it is not something a reversal gets to erase.
 *  - **It is terminal for that submission.** `Placement.submissionId` is unique,
 *    so a reversed placement cannot be replaced by a second one on the same
 *    submission. A candidate who joins, leaves and rejoins is submitted again —
 *    which is the honest reading anyway, since the second engagement is a
 *    different one.
 */

export type ReversePlacementResult =
  | {
      ok: true
      candidateName: string
      requirementCode: string
      /** Whether the lead's derived outcome moved as a result. */
      leadStatusChanged: boolean
    }
  | { ok: false; message: string }

export async function reversePlacement(input: {
  placementId: string
  reason: string
  actorId: string
}): Promise<ReversePlacementResult> {
  return auditedTransaction(async (tx) => {
    const placement = await tx.placement.findUnique({
      where: { id: input.placementId },
      select: {
        id: true,
        reversedAt: true,
        placementValue: true,
        leadId: true,
        candidate: { select: { fullName: true } },
        requirement: {
          select: {
            id: true,
            requirementCode: true,
            openings: true,
            positionsFilled: true,
            currentStage: { select: { isWon: true, isLost: true } },
          },
        },
      },
    })

    if (!placement) {
      return { ok: false as const, message: 'That placement no longer exists.' }
    }

    if (placement.reversedAt) {
      return {
        ok: false as const,
        message: `${placement.candidate.fullName}'s placement has already been reversed.`,
      }
    }

    const live = await tx.invoice.findMany({
      where: { placementId: placement.id, status: { not: 'CANCELLED' } },
      select: { invoiceNumber: true },
    })

    if (live.length > 0) {
      const numbers = live.map((invoice) => invoice.invoiceNumber).join(', ')
      return {
        ok: false as const,
        message: `${numbers} ${live.length === 1 ? 'is' : 'are'} still standing against this placement. Cancel or credit ${live.length === 1 ? 'it' : 'them'} first — reversing while the client is still being billed would take the revenue out of the reports and leave the invoice in place.`,
      }
    }

    const now = new Date()

    await tx.placement.update({
      where: { id: placement.id },
      data: {
        reversedAt: now,
        reversedById: input.actorId,
        reversalReason: input.reason,
      },
    })

    // Give the opening back with a conditional decrement, not by writing the
    // number this transaction read a moment ago. Two people reversing the two
    // placements on a two-opening requirement at the same time would both read
    // `positionsFilled = 2`, both compute 1, and both write 1 — one opening
    // never comes back and Fill Rate over-reports for ever. `recordPlacement`
    // claims an opening the same way on the way in, and for the same reason
    // (see src/lib/staffing/submission.ts).
    //
    // Guarded above zero rather than floored after the fact: a decrement that
    // would go negative means the data was already wrong, and the guard makes
    // that a no-op instead of a silent repair.
    await tx.requirement.updateMany({
      where: { id: placement.requirement.id, positionsFilled: { gt: 0 } },
      data: { positionsFilled: { decrement: 1 } },
    })

    // Re-read rather than assuming `positionsFilled - 1`: under the contention
    // the conditional update exists to handle, the value this transaction
    // landed on is not necessarily the one it read at the top.
    const claimed = await tx.requirement.findUniqueOrThrow({
      where: { id: placement.requirement.id },
      select: { positionsFilled: true, openings: true },
    })

    const status = requirementStatusFor(
      {
        isWon: placement.requirement.currentStage?.isWon ?? false,
        isLost: placement.requirement.currentStage?.isLost ?? false,
      },
      claimed.openings,
      claimed.positionsFilled,
    )

    await tx.requirement.update({
      where: { id: placement.requirement.id },
      data: {
        status,
        // A requirement that is no longer FILLED is being worked again, so its
        // closing date goes with the status that produced it.
        closedAt: status === 'FILLED' || status === 'LOST' ? undefined : null,
      },
    })

    await tx.activity.create({
      data: {
        type: 'NOTE',
        subject: `${placement.candidate.fullName}: placement reversed`,
        notes: input.reason,
        activityDate: now,
        userId: input.actorId,
        requirementId: placement.requirement.id,
      },
    })

    await recordAudit({
      entityType: 'SUBMISSION',
      entityId: placement.id,
      action: 'UPDATE',
      fieldName: 'reversedAt',
      oldValue: placement.placementValue.toString(),
      newValue: `reversed: ${input.reason}`,
      userId: input.actorId,
    })

    const before = await tx.lead.findUnique({
      where: { id: placement.leadId },
      select: { status: true },
    })

    const after = await syncStaffingLeadOutcome(tx, {
      leadId: placement.leadId,
      actorId: input.actorId,
      at: now,
    })

    return {
      ok: true as const,
      candidateName: placement.candidate.fullName,
      requirementCode: placement.requirement.requirementCode,
      leadStatusChanged: after !== null && after !== before?.status,
    }
  })
}
