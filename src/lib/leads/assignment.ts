import 'server-only'

import { auditedTransaction, type TransactionClient } from '@/lib/db'
import { recordAudit } from '@/lib/audit/record'

/**
 * Assignment and reassignment (README §7, open question Q3).
 *
 * `generatedById` and `assignedToId` are separate columns and stay that way:
 * BDE Performance (§27) counts what a person *sourced*, BDM Conversion (§28)
 * counts what a person *closed*, and merging the two would make both reports
 * impossible. Reassigning a lead therefore never touches who generated it —
 * that is the fact `LeadAssignmentHistory` exists to protect.
 */

export type AssignmentResult =
  | { ok: true; leadCode: string; toName: string }
  | { ok: false; message: string; field?: string }

/**
 * Write the assignment history row and the timeline entry for a handover.
 *
 * Split out so lead creation can call it inside its own transaction: a lead
 * created already assigned to a BDM still needs its first history row, or the
 * handover chain starts with a gap.
 */
export async function recordAssignment(
  tx: TransactionClient,
  input: {
    leadId: string
    fromUserId: string | null
    toUserId: string
    toName: string
    actorId: string
    reason: string | null
    at: Date
  },
): Promise<void> {
  await tx.leadAssignmentHistory.create({
    data: {
      leadId: input.leadId,
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      assignedById: input.actorId,
      assignedAt: input.at,
      reason: input.reason,
    },
  })

  await tx.activity.create({
    data: {
      type: 'ASSIGNMENT',
      subject: input.fromUserId
        ? `Reassigned to ${input.toName}`
        : `Assigned to ${input.toName}`,
      notes: input.reason,
      activityDate: input.at,
      userId: input.actorId,
      leadId: input.leadId,
    },
  })
}

/**
 * Hand a lead to someone else.
 *
 * The new owner's `teamId` and `departmentId` are copied onto the lead, because
 * the team filter on the dashboard reads the lead's own columns rather than
 * joining through the current assignee — a lead that moved between teams has to
 * count for the team working it now, and history keeps the rest.
 */
export async function assignLead(input: {
  leadId: string
  toUserId: string
  actorId: string
  reason: string | null
}): Promise<AssignmentResult> {
  return auditedTransaction(async (tx) => {
    const lead = await tx.lead.findUnique({
      where: { id: input.leadId },
      select: {
        id: true,
        leadCode: true,
        assignedToId: true,
        assignedTo: { select: { name: true } },
      },
    })

    if (!lead) return { ok: false as const, message: 'That lead no longer exists.' }

    if (lead.assignedToId === input.toUserId) {
      return {
        ok: false as const,
        message: 'That person already owns this lead.',
        field: 'toUserId',
      }
    }

    // The id comes from a form field, so it is checked rather than trusted.
    // Assigning to a deactivated account would hide the lead from everyone:
    // their session stops working immediately, and nobody inherits their queue.
    const toUser = await tx.user.findUnique({
      where: { id: input.toUserId },
      select: { id: true, name: true, isActive: true, teamId: true, departmentId: true },
    })

    if (!toUser || !toUser.isActive) {
      return {
        ok: false as const,
        message: 'That user is not available for assignment.',
        field: 'toUserId',
      }
    }

    const now = new Date()

    await tx.lead.update({
      where: { id: lead.id },
      data: {
        assignedToId: toUser.id,
        teamId: toUser.teamId,
        departmentId: toUser.departmentId,
      },
    })

    await recordAssignment(tx, {
      leadId: lead.id,
      fromUserId: lead.assignedToId,
      toUserId: toUser.id,
      toName: toUser.name,
      actorId: input.actorId,
      reason: input.reason,
      at: now,
    })

    // ASSIGN and REASSIGN are distinct actions in `AuditAction`; the ORM writer
    // would record both as an ordinary `assignedToId` update and lose which
    // one it was.
    await recordAudit({
      entityType: 'LEAD',
      entityId: lead.id,
      action: lead.assignedToId ? 'REASSIGN' : 'ASSIGN',
      fieldName: 'assignedToId',
      oldValue: lead.assignedTo?.name ?? null,
      newValue: toUser.name,
      userId: input.actorId,
    })

    return { ok: true as const, leadCode: lead.leadCode, toName: toUser.name }
  })
}
