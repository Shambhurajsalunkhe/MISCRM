import 'server-only'

import { prisma } from '@/lib/db'
import { fromCents, sumCents, toCents } from '@/lib/commercials/money'
import { overdueWhere } from '@/lib/commercials/overdue'
import {
  instants,
  leadFacts,
  leadsCreatedWhere,
  openPipelineWhere,
  type AnalyticsScope,
} from '@/lib/reports/filters'
import type { LeadStatus } from '@/generated/prisma/enums'

/**
 * The dashboard KPIs of docs/02-funnels-and-metrics.md §5, computed once.
 *
 * Every one of these numbers appears on the dashboard, on at least one report
 * and in at least one export, and the three have to agree — so they are read
 * from here rather than assembled per screen. The three revenue figures
 * themselves come from the same definitions Phase 5 established in
 * `src/lib/commercials/revenue.ts`; this module is the same arithmetic asked
 * across many leads instead of one.
 *
 * **Three date rules, and they are not the same rule.** The plan's Q5 caveat is
 * about volume; this is about meaning, and it is the thing people misread:
 *
 *  - **Counts** — Total, Open, Won, Lost — are the *creation cohort*: leads
 *    created in the period. One cohort means Open + Won + Lost = Total and the
 *    conversion has a denominator anybody can point at. Dating Won by when it
 *    was won instead would produce a row whose parts exceed its whole.
 *  - **Won and Collected revenue** are *flows*, dated by the event that booked
 *    them: the day a deal closed, the day a candidate joined, the day a payment
 *    arrived. Money belongs to the month it moved in.
 *  - **Pipeline and Pending revenue** are *stocks*, as at today, and ignore the
 *    range entirely. "What is in play" and "what is owed" do not become
 *    different numbers because a report was narrowed to last month, and a card
 *    that visibly ignores the date filter is only confusing if the screen does
 *    not say so. Every screen showing them says so.
 */

export type LeadCounts = {
  total: number
  open: number
  won: number
  lost: number
}

const EMPTY_COUNTS: LeadCounts = { total: 0, open: 0, won: 0, lost: 0 }

function countsFrom(rows: Array<{ status: LeadStatus; count: number }>): LeadCounts {
  const counts = { ...EMPTY_COUNTS }

  for (const row of rows) {
    counts.total += row.count
    if (row.status === 'OPEN') counts.open += row.count
    if (row.status === 'WON') counts.won += row.count
    if (row.status === 'LOST') counts.lost += row.count
  }

  return counts
}

/** Total / Open / Won / Lost over the creation cohort. */
export async function leadCounts(scope: AnalyticsScope): Promise<LeadCounts> {
  const rows = await prisma.lead.groupBy({
    by: ['status'],
    where: leadsCreatedWhere(scope),
    _count: { _all: true },
  })

  return countsFrom(
    rows.map((row) => ({ status: row.status, count: row._count._all })),
  )
}

/** The same four numbers per vertical, in one query. */
export async function leadCountsByVertical(
  scope: AnalyticsScope,
): Promise<Map<string, LeadCounts>> {
  const rows = await prisma.lead.groupBy({
    by: ['verticalId', 'status'],
    where: leadsCreatedWhere(scope),
    _count: { _all: true },
  })

  const byVertical = new Map<string, LeadCounts>()

  for (const row of rows) {
    const current = byVertical.get(row.verticalId) ?? { ...EMPTY_COUNTS }
    const next = countsFrom([{ status: row.status, count: row._count._all }])

    byVertical.set(row.verticalId, {
      total: current.total + next.total,
      open: current.open + next.open,
      won: current.won + next.won,
      lost: current.lost + next.lost,
    })
  }

  return byVertical
}

/** The same four numbers grouped by whoever generated or owns the lead. */
export async function leadCountsByPerson(
  scope: AnalyticsScope,
  by: 'generatedById' | 'assignedToId',
): Promise<Map<string, LeadCounts>> {
  const rows = await prisma.lead.groupBy({
    by: [by, 'status'],
    where: leadsCreatedWhere(scope),
    _count: { _all: true },
  })

  const byPerson = new Map<string, LeadCounts>()

  for (const row of rows) {
    const key = row[by]
    if (!key) continue

    const current = byPerson.get(key) ?? { ...EMPTY_COUNTS }
    const next = countsFrom([{ status: row.status, count: row._count._all }])

    byPerson.set(key, {
      total: current.total + next.total,
      open: current.open + next.open,
      won: current.won + next.won,
      lost: current.lost + next.lost,
    })
  }

  return byPerson
}

export type PipelineValue = {
  /** `SUM(COALESCE(dealValue, expectedBudget))` over open leads. */
  total: number
  byVertical: Map<string, number>
  leads: number
}

/**
 * Pipeline Value — what is currently in play.
 *
 * `COALESCE(dealValue, expectedBudget)` per docs/02 §5: a deal that has been
 * negotiated to a figure uses that figure, and one that has not falls back to
 * what the client said their budget was. The fallback is the only honest option
 * — pricing an open deal at nothing understates the pipeline, and pricing it at
 * the budget is at least a number somebody said out loud.
 *
 * Read row by row rather than aggregated in SQL because `COALESCE` inside a
 * `SUM` is not something Prisma's aggregate can express, and the set is open
 * leads only. That holds at the volumes open question Q5 assumes; it is the same
 * bound as the lead list's hundred-row page, one query wider.
 */
export async function pipelineValue(
  scope: AnalyticsScope,
): Promise<PipelineValue> {
  const rows = await prisma.lead.findMany({
    where: openPipelineWhere(scope),
    select: { verticalId: true, dealValue: true, expectedBudget: true },
  })

  const byVertical = new Map<string, number>()
  let cents = 0

  for (const row of rows) {
    const value = toCents(row.dealValue ?? row.expectedBudget)
    cents += value
    byVertical.set(row.verticalId, (byVertical.get(row.verticalId) ?? 0) + value)
  }

  return {
    total: fromCents(cents),
    byVertical: new Map(
      [...byVertical].map(([id, value]) => [id, fromCents(value)]),
    ),
    leads: rows.length,
  }
}

export type RevenueTotals = {
  won: number
  collected: number
  pending: number
  overdue: number
  /**
   * Raised: the total of every live invoice in scope, all dates. Compared against
   * `won` to expose the gap docs/02 §5 asks to be visible — won work nobody has
   * billed for — which the revenue report computes and names.
   */
  invoiced: number
}

export type RevenueByVertical = Map<
  string,
  { won: number; collected: number; pending: number }
>

/**
 * Won, Collected and Pending revenue over a filter set, and the same three per
 * vertical.
 *
 * The Won split is decision D8 rather than a special case: a staffing lead can
 * be *partly* won, so its value lives on its placements and not on a single
 * `dealValue` that would have to be re-typed every time another candidate
 * joined. `usesRequirements` is the switch, read off the vertical — never a list
 * of vertical codes, the same rule the funnel builder and the lead form follow.
 *
 * Q11 is what makes the three comparable at all: invoicing is enabled for every
 * vertical (docs/02 §5), so `Collected + Pending` reconciles to `Won` everywhere
 * rather than in three verticals out of eight. Where it does not reconcile the
 * gap is real — a won deal nobody has invoiced — and the revenue report names it
 * instead of hiding it.
 */
export async function revenueTotals(scope: AnalyticsScope): Promise<{
  totals: RevenueTotals
  byVertical: RevenueByVertical
}> {
  const facts = leadFacts(scope)
  const period = instants(scope.range)

  const [closedLeads, placements, payments, invoices, overdue] =
    await Promise.all([
      // Won revenue, non-staffing: the deal value of leads that closed won in
      // the period. `status` is checked as well as `closedAt`, because a lead
      // re-opened after being marked won keeps its close date until it closes
      // again.
      prisma.lead.findMany({
        where: { ...facts, status: 'WON', closedAt: period },
        select: {
          verticalId: true,
          dealValue: true,
          vertical: { select: { usesRequirements: true } },
        },
      }),
      // Won revenue, staffing: placements that joined in the period. Reversals
      // are excluded here and everywhere else money is counted — a candidate who
      // withdrew after joining did not fill the role.
      prisma.placement.findMany({
        where: { joiningDate: period, reversedAt: null, lead: facts },
        select: { placementValue: true, lead: { select: { verticalId: true } } },
      }),
      // Collected: `SUM(Payment.amount)` in the period, read from the receipts
      // rather than from `Invoice.amountReceived`. The column is a cache of
      // exactly this, and summing the cache would make a drift invisible.
      prisma.payment.findMany({
        where: {
          paymentDate: period,
          invoice: { status: { not: 'CANCELLED' }, lead: facts },
        },
        select: {
          amount: true,
          invoice: { select: { lead: { select: { verticalId: true } } } },
        },
      }),
      // Pending and Invoiced are stocks: every live invoice, whenever it was
      // raised. See the date rules at the top of this module.
      prisma.invoice.findMany({
        where: { status: { not: 'CANCELLED' }, lead: facts },
        select: {
          totalAmount: true,
          amountPending: true,
          lead: { select: { verticalId: true } },
        },
      }),
      prisma.invoice.aggregate({
        where: { lead: facts, AND: [overdueWhere()] },
        _sum: { amountPending: true },
      }),
    ])

  const byVertical: Map<
    string,
    { won: number; collected: number; pending: number }
  > = new Map()

  const bump = (
    verticalId: string,
    key: 'won' | 'collected' | 'pending',
    cents: number,
  ) => {
    const current =
      byVertical.get(verticalId) ?? { won: 0, collected: 0, pending: 0 }
    current[key] += cents
    byVertical.set(verticalId, current)
  }

  let wonCents = 0
  for (const lead of closedLeads) {
    if (lead.vertical.usesRequirements) continue
    const value = toCents(lead.dealValue)
    wonCents += value
    bump(lead.verticalId, 'won', value)
  }

  for (const placement of placements) {
    const value = toCents(placement.placementValue)
    wonCents += value
    bump(placement.lead.verticalId, 'won', value)
  }

  let collectedCents = 0
  for (const payment of payments) {
    const value = toCents(payment.amount)
    collectedCents += value
    bump(payment.invoice.lead.verticalId, 'collected', value)
  }

  let pendingCents = 0
  for (const invoice of invoices) {
    const value = toCents(invoice.amountPending)
    pendingCents += value
    bump(invoice.lead.verticalId, 'pending', value)
  }

  return {
    totals: {
      won: fromCents(wonCents),
      collected: fromCents(collectedCents),
      pending: fromCents(pendingCents),
      overdue: fromCents(toCents(overdue._sum.amountPending)),
      invoiced: fromCents(
        sumCents(invoices.map((invoice) => invoice.totalAmount)),
      ),
    },
    byVertical: new Map(
      [...byVertical].map(([id, money]) => [
        id,
        {
          won: fromCents(money.won),
          collected: fromCents(money.collected),
          pending: fromCents(money.pending),
        },
      ]),
    ),
  }
}

/** `won ÷ (won + lost)`, the overall conversion of docs/02 §5. */
export function conversion(counts: LeadCounts): number | null {
  const decided = counts.won + counts.lost
  if (decided <= 0) return null
  return (counts.won / decided) * 100
}
