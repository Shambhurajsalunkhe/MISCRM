import 'server-only'

import { prisma } from '@/lib/db'
import { deriveInvoiceStatus, startOfDay } from '@/lib/commercials/invoice'
import { toCents } from '@/lib/commercials/money'
import type { InvoiceStatus } from '@/generated/prisma/enums'

/**
 * OVERDUE is the one invoice status that turns over with the calendar rather
 * than with a user action (docs/01-data-model.md §3). Nobody edits an invoice on
 * the day it falls due; it simply becomes late while the application is idle.
 *
 * That leaves two jobs, and this module does both rather than picking one:
 *
 *  1. **Every screen derives what it shows.** `displayStatus` recomputes from
 *     the total, what has been received and the due date, so an invoice that
 *     fell due overnight reads as overdue on the next page load whether or not
 *     any job has run. A register that tells a collections chaser an invoice is
 *     Pending because a cron missed a night is worse than having no chip at all.
 *  2. **A sweep keeps the stored column honest.** `Invoice(status, dueDate)` is
 *     an index the register filters on and the dashboard will aggregate over in
 *     Phase 6, and a column that disagrees with the derivation is a query that
 *     silently returns the wrong rows.
 *
 * The sweep is exposed as a route handler rather than an in-process schedule.
 * The plan puts node-cron in Phase 7 alongside the follow-up and aging jobs,
 * and the hosting target is still open (Q7) — a scheduler wired into the app
 * process now would be built before the decision that determines whether it can
 * run at all. Point any scheduler at the endpoint in the meantime; the sweep is
 * idempotent, so running it twice or missing a night both come out the same.
 */

/** Invoices that are past due and still owe money. */
export function overdueWhere(now: Date = new Date()) {
  return {
    status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] as InvoiceStatus[] },
    dueDate: { lt: startOfDay(now) },
    amountPending: { gt: 0 },
  }
}

/**
 * What an invoice's chip should say right now.
 *
 * The stored column is what queries filter on; this is what people read. They
 * agree except in the window between an invoice falling due and the next sweep.
 */
export function displayStatus(
  invoice: {
    status: InvoiceStatus
    totalAmount: { toString: () => string } | number
    amountReceived: { toString: () => string } | number
    dueDate: Date | null
  },
  now: Date = new Date(),
): InvoiceStatus {
  return deriveInvoiceStatus(
    {
      totalAmount: Number(invoice.totalAmount.toString()),
      amountReceived: Number(invoice.amountReceived.toString()),
      dueDate: invoice.dueDate,
      cancelled: invoice.status === 'CANCELLED',
    },
    now,
  )
}

export type SweepResult = { markedOverdue: number; clearedOverdue: number }

/**
 * Re-evaluate OVERDUE across the ledger.
 *
 * Both directions, because a due date is editable: an invoice re-dated forward
 * after a client agreed new terms has to stop being overdue, and only this job
 * would ever notice. `amendInvoice` recomputes the row it touches, so the
 * clearing pass is a backstop rather than the main path — but it is the pass
 * that makes running the sweep safe at any time rather than only after midnight.
 *
 * CANCELLED and PAID are untouched in both directions. Neither owes anything,
 * and a cancelled invoice that started reporting itself overdue would put money
 * back into Pending Revenue that was deliberately taken out of it.
 */
export async function sweepOverdueInvoices(
  now: Date = new Date(),
): Promise<SweepResult> {
  const today = startOfDay(now)

  const [marked, cleared] = await Promise.all([
    prisma.invoice.updateMany({
      where: {
        status: { in: ['PENDING', 'PARTIALLY_PAID'] },
        dueDate: { lt: today },
        amountPending: { gt: 0 },
      },
      data: { status: 'OVERDUE' },
    }),
    // Rows still flagged overdue that no longer are: the due date moved, or the
    // amount was settled by a path that somehow did not recompute. Each is
    // re-derived individually because the right answer differs per row —
    // PARTIALLY_PAID for one, PENDING for the next.
    prisma.invoice
      .findMany({
        where: {
          status: 'OVERDUE',
          OR: [
            { dueDate: null },
            { dueDate: { gte: today } },
            { amountPending: { lte: 0 } },
          ],
        },
        select: {
          id: true,
          totalAmount: true,
          amountReceived: true,
          dueDate: true,
        },
      })
      .then(async (rows) => {
        for (const row of rows) {
          await prisma.invoice.update({
            where: { id: row.id },
            data: {
              status: deriveInvoiceStatus(
                {
                  totalAmount: Number(row.totalAmount.toString()),
                  amountReceived: Number(row.amountReceived.toString()),
                  dueDate: row.dueDate,
                  cancelled: false,
                },
                now,
              ),
            },
          })
        }
        return rows.length
      }),
  ])

  return { markedOverdue: marked.count, clearedOverdue: cleared }
}

/** Days late, for the register's ageing column. Zero when not yet due. */
export function daysOverdue(dueDate: Date | null, now: Date = new Date()): number {
  if (!dueDate) return 0
  const days = Math.floor(
    (startOfDay(now).getTime() - startOfDay(dueDate).getTime()) / 86_400_000,
  )
  return days > 0 ? days : 0
}

/** True when there is still money outstanding on this row. */
export function stillOwing(invoice: {
  amountPending: { toString: () => string } | number
}): boolean {
  return toCents(invoice.amountPending) > 0
}
