import 'server-only'

import { prisma } from '@/lib/db'
import { fromCents, toCents } from '@/lib/commercials/money'
import { daysOverdue, displayStatus } from '@/lib/commercials/overdue'
import {
  instants,
  leadFacts,
  type AnalyticsScope,
} from '@/lib/reports/filters'
import type { InvoiceStatus } from '@/generated/prisma/enums'

/**
 * Payment Status (README §29) — the collections view.
 *
 * Two halves, deliberately dated differently, and the screen labels both:
 *
 *  - **Raised in the period.** The invoice table and the status split: what was
 *    billed while the report's window was open.
 *  - **Outstanding now, all dates.** The ageing buckets. Money owed is a stock,
 *    and an invoice from March that is still unpaid belongs in a collections
 *    report run in August. Restricting the ageing to the window would hide
 *    exactly the debt somebody opened the report to find.
 *
 * Status is the *derived* one throughout (`displayStatus`), not the stored
 * column — Phase 5's second decision on invoices. An invoice that fell due
 * overnight reads as overdue here whether or not the sweep has run, because a
 * collections report that is wrong for a morning is worse than one with no chips
 * at all.
 */

export const INVOICE_LIMIT = 1_000

export type PaymentRow = {
  id: string
  invoiceNumber: string
  client: string
  leadCode: string
  leadId: string
  vertical: string
  invoiceDate: Date
  dueDate: Date | null
  total: number
  received: number
  pending: number
  status: InvoiceStatus
  daysOverdue: number
}

export type AgeingBucket = {
  label: string
  count: number
  amount: number
}

export type PaymentsReport = {
  rows: PaymentRow[]
  truncated: boolean
  /** Counts and amounts by derived status, over the invoices raised in the period. */
  byStatus: Array<{ status: InvoiceStatus; count: number; total: number; pending: number }>
  raised: { count: number; total: number; collected: number; pending: number }
  /** As at today, every live invoice in scope regardless of when it was raised. */
  outstanding: { count: number; pending: number; overdue: number; overdueCount: number }
  ageing: AgeingBucket[]
}

/**
 * The ageing ladder. Thirty-day bands are what every finance team asks for, and
 * "not yet due" is kept separate from "0–30 days late" because the two mean
 * opposite things about the same invoice.
 */
const BANDS: Array<{ label: string; from: number; to: number | null }> = [
  { label: 'Not yet due', from: -Infinity, to: 0 },
  { label: '1–30 days', from: 1, to: 30 },
  { label: '31–60 days', from: 31, to: 60 },
  { label: '61–90 days', from: 61, to: 90 },
  { label: 'Over 90 days', from: 91, to: null },
]

export async function loadPayments(
  scope: AnalyticsScope,
): Promise<PaymentsReport> {
  const facts = leadFacts(scope)
  const period = instants(scope.range)
  const now = new Date()

  const [raisedRows, liveRows] = await Promise.all([
    prisma.invoice.findMany({
      where: { lead: facts, invoiceDate: period },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        dueDate: true,
        totalAmount: true,
        amountReceived: true,
        amountPending: true,
        status: true,
        client: { select: { companyName: true } },
        lead: {
          select: {
            id: true,
            leadCode: true,
            vertical: { select: { name: true } },
          },
        },
      },
      orderBy: [{ dueDate: 'asc' }, { invoiceDate: 'desc' }],
      take: INVOICE_LIMIT + 1,
    }),
    // The stock half: everything still owing, whenever it was raised. Only the
    // three columns the ladder needs, so this stays cheap as the ledger grows.
    prisma.invoice.findMany({
      where: {
        lead: facts,
        status: { not: 'CANCELLED' },
        amountPending: { gt: 0 },
      },
      select: { dueDate: true, amountPending: true },
    }),
  ])

  const truncated = raisedRows.length > INVOICE_LIMIT
  const kept = truncated ? raisedRows.slice(0, INVOICE_LIMIT) : raisedRows

  const rows: PaymentRow[] = kept.map((invoice) => ({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    client: invoice.client.companyName,
    leadCode: invoice.lead.leadCode,
    leadId: invoice.lead.id,
    vertical: invoice.lead.vertical.name,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    total: fromCents(toCents(invoice.totalAmount)),
    received: fromCents(toCents(invoice.amountReceived)),
    pending: fromCents(toCents(invoice.amountPending)),
    status: displayStatus(invoice, now),
    daysOverdue: daysOverdue(invoice.dueDate, now),
  }))

  const byStatus = new Map<
    InvoiceStatus,
    { count: number; total: number; pending: number }
  >()

  let raisedTotal = 0
  let raisedCollected = 0
  let raisedPending = 0

  for (const row of rows) {
    const bucket =
      byStatus.get(row.status) ?? { count: 0, total: 0, pending: 0 }
    bucket.count += 1
    bucket.total += row.total
    bucket.pending += row.pending
    byStatus.set(row.status, bucket)

    // Cancelled invoices stay in the table — an invoice raised and withdrawn is
    // part of what happened — but never in the money, for the same reason
    // Phase 5 excluded them from every revenue figure.
    if (row.status !== 'CANCELLED') {
      raisedTotal += row.total
      raisedCollected += row.received
      raisedPending += row.pending
    }
  }

  const ageing = BANDS.map((band) => ({ label: band.label, count: 0, amount: 0 }))
  let outstandingPending = 0
  let overdueAmount = 0
  let overdueCount = 0

  for (const invoice of liveRows) {
    const pending = fromCents(toCents(invoice.amountPending))
    const late = daysOverdue(invoice.dueDate, now)
    outstandingPending += pending

    // No due date is "not yet due": nobody has said when it is payable, and
    // guessing a date would put an invoice into arrears on our own authority.
    const index =
      invoice.dueDate === null || late <= 0
        ? 0
        : BANDS.findIndex(
            (band) =>
              late >= band.from && (band.to === null || late <= band.to),
          )

    const bucket = ageing[index === -1 ? BANDS.length - 1 : index]
    bucket.count += 1
    bucket.amount += pending

    if (late > 0) {
      overdueAmount += pending
      overdueCount += 1
    }
  }

  return {
    rows,
    truncated,
    byStatus: [...byStatus]
      .map(([status, bucket]) => ({ status, ...bucket }))
      .sort((a, b) => b.pending - a.pending || b.total - a.total),
    raised: {
      count: rows.filter((row) => row.status !== 'CANCELLED').length,
      total: raisedTotal,
      collected: raisedCollected,
      pending: raisedPending,
    },
    outstanding: {
      count: liveRows.length,
      pending: outstandingPending,
      overdue: overdueAmount,
      overdueCount,
    },
    ageing,
  }
}
