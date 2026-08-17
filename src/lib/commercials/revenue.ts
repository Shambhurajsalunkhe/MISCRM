import 'server-only'

import { prisma } from '@/lib/db'
import { fromCents, sumCents, toCents } from '@/lib/commercials/money'
import { overdueWhere } from '@/lib/commercials/overdue'
import type { LeadStatus } from '@/generated/prisma/enums'
import type { InvoiceWhereInput } from '@/generated/prisma/models/Invoice'

/**
 * Won, Collected and Pending revenue (docs/02-funnels-and-metrics.md §5).
 *
 * Three numbers that have to mean the same thing on every screen, so they are
 * computed here and nowhere else:
 *
 *   Won       non-staffing: `Lead.dealValue` where the lead is WON
 *             staffing:     `SUM(Placement.placementValue)`, reversals excluded
 *   Collected `SUM(Payment.amount)`
 *   Pending   `SUM(Invoice.amountPending)` where the invoice is not cancelled
 *
 * Q11 is what makes the three comparable: invoicing is on for every vertical
 * (docs/02 §5), so `Collected + Pending` reconciles to `Won` everywhere rather
 * than in three verticals out of eight. Where it does not reconcile, the gap is
 * real and worth seeing — a won deal nobody has invoiced yet.
 *
 * The staffing split is not a special case bolted on. It is decision D8: a
 * staffing lead can be partly won, so its value lives on the placements and not
 * on a single `dealValue` field that would have to be re-typed every time
 * another candidate joined. `usesRequirements` is the switch, read from the
 * vertical, never a list of vertical codes.
 */

export type LeadMoney = {
  /** What this deal is worth, per the rule above. */
  won: number
  /** Raised: the sum of every non-cancelled invoice's total. */
  invoiced: number
  collected: number
  pending: number
  /** Won minus invoiced, floored at zero — value with no invoice behind it. */
  uninvoiced: number
  invoiceCount: number
}

export async function leadMoney(lead: {
  id: string
  status: LeadStatus
  dealValue: { toString: () => string } | number | null
  vertical: { usesRequirements: boolean }
}): Promise<LeadMoney> {
  const [placements, invoices, payments] = await Promise.all([
    lead.vertical.usesRequirements
      ? prisma.placement.findMany({
          where: { leadId: lead.id, reversedAt: null },
          select: { placementValue: true },
        })
      : Promise.resolve([]),
    prisma.invoice.findMany({
      where: { leadId: lead.id, status: { not: 'CANCELLED' } },
      select: { totalAmount: true, amountPending: true },
    }),
    // Read from `Payment` rather than summing `Invoice.amountReceived`, because
    // docs/02 §5 defines Collected Revenue as `SUM(Payment.amount)` and the
    // column is a cache of exactly that. Summing the cache would make a drifted
    // column invisible; summing the receipts makes it show up as a difference.
    prisma.payment.findMany({
      where: { invoice: { leadId: lead.id, status: { not: 'CANCELLED' } } },
      select: { amount: true },
    }),
  ])

  const wonCents = lead.vertical.usesRequirements
    ? sumCents(placements.map((placement) => placement.placementValue))
    : lead.status === 'WON'
      ? toCents(lead.dealValue)
      : 0

  const invoicedCents = sumCents(invoices.map((invoice) => invoice.totalAmount))
  const pendingCents = sumCents(invoices.map((invoice) => invoice.amountPending))
  const collectedCents = sumCents(payments.map((payment) => payment.amount))

  return {
    won: fromCents(wonCents),
    invoiced: fromCents(invoicedCents),
    collected: fromCents(collectedCents),
    pending: fromCents(pendingCents),
    uninvoiced: fromCents(Math.max(wonCents - invoicedCents, 0)),
    invoiceCount: invoices.length,
  }
}

export type InvoiceTotals = {
  invoiced: number
  collected: number
  pending: number
  overdue: number
  count: number
  overdueCount: number
}

/**
 * The header figures on the invoice register, over whatever filter is applied.
 *
 * `where` is the caller's fully-scoped filter — it already carries the lead
 * visibility fragment — so this can never widen what the list below it shows.
 * Cancelled invoices are excluded from the money but not from the list, which
 * is why the count here can be smaller than the number of rows on screen; the
 * register says so in its footer.
 */
export async function invoiceTotals(
  where: InvoiceWhereInput,
): Promise<InvoiceTotals> {
  // Cancelled invoices are excluded through `AND` rather than by setting
  // `status` directly. A spread would overwrite a `status` the caller had
  // already put in `where` — so with the register filtered to "Paid", the cards
  // above the list would quietly total every live invoice instead, and read as
  // money outstanding on a page where every visible row shows nothing owed.
  const existing: InvoiceWhereInput[] =
    where.AND === undefined
      ? []
      : Array.isArray(where.AND)
        ? where.AND
        : [where.AND]

  const live = {
    ...where,
    AND: [...existing, { status: { not: 'CANCELLED' } }] as InvoiceWhereInput[],
  }

  const [totals, overdue, payments] = await Promise.all([
    prisma.invoice.aggregate({
      where: live,
      _count: { _all: true },
      _sum: { totalAmount: true, amountPending: true },
    }),
    // Past due by the derivation rather than by the stored column, so the card
    // is right on a morning the sweep has not run yet — see
    // src/lib/commercials/overdue.ts for why both exist.
    //
    // Appended to `AND` for the same reason the cancelled exclusion is:
    // `overdueWhere()` carries its own `status`, and spreading it would discard
    // the caller's — leaving this card totalling every overdue invoice while
    // the list beside it showed a single status.
    prisma.invoice.aggregate({
      where: { ...live, AND: [...live.AND, overdueWhere()] },
      _count: { _all: true },
      _sum: { amountPending: true },
    }),
    prisma.payment.aggregate({
      where: { invoice: live },
      _sum: { amount: true },
    }),
  ])

  return {
    invoiced: fromCents(toCents(totals._sum.totalAmount)),
    collected: fromCents(toCents(payments._sum.amount)),
    pending: fromCents(toCents(totals._sum.amountPending)),
    overdue: fromCents(toCents(overdue._sum.amountPending)),
    count: totals._count._all,
    overdueCount: overdue._count._all,
  }
}
