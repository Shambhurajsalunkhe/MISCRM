import 'server-only'

import { prisma } from '@/lib/db'
import { fromCents } from '@/lib/commercials/money'
import {
  acceptedQuotationCentsByVertical,
  demoCountsByVertical,
  reachedGrouped,
} from '@/lib/reports/aggregate'
import { leadsCreatedWhere, type AnalyticsScope } from '@/lib/reports/filters'
import { verticalsWithStages } from '@/lib/reports/options'
import { rate } from '@/lib/prospecting/metrics'
import type { DemoStatus } from '@/generated/prisma/enums'

/**
 * Product demos (docs/02 §4.6, README §20) — inquiries, demos, proposals, orders
 * and order value.
 *
 * Which verticals appear is read off the `usesDemos` and `usesQuotations` module
 * switches, never a list of vertical codes. Product Sales is the vertical this
 * report was written for, but a Digital Marketing team that turns demos on gets
 * its row here the same day, and turning them off removes it — the rule the lead
 * form and the funnel builder have followed since Phase 2.
 *
 * Decision D11 is why demos are counted separately from leads at all: the
 * dashboard shows 120 demos against 60 leads, so a demo cannot be a stage — it is
 * a repeatable child record, and a lead can have several.
 *
 * The proposal and won figures come from the **common** stages rather than from
 * `QUOTATION_SHARED` and `ORDER_WON` by code. §4.6 names the Product Sales codes,
 * but the mapping to PROPOSAL and WON is exactly what decision D5's common layer
 * exists for, and reading the common bucket means a renamed or re-coded stage
 * keeps reporting instead of silently reading zero.
 */

export type DemoVerticalRow = {
  verticalId: string
  vertical: string
  inquiries: number
  scheduled: number
  completed: number
  leadsWithDemo: number
  leadsWithCompletedDemo: number
  reachedProposal: number
  reachedNegotiation: number
  won: number
  orderValue: number
  averageOrderValue: number | null
  inquiryToDemo: number | null
  demoToProposal: number | null
  negotiationToWon: number | null
  inquiryToWon: number | null
}

export type DemosReport = {
  rows: DemoVerticalRow[]
  totals: {
    inquiries: number
    scheduled: number
    completed: number
    won: number
    orderValue: number
    averageOrderValue: number | null
  }
  /** Demos in the period by status — held, no-show, cancelled. */
  byStatus: Array<[DemoStatus, number]>
  /** True when no vertical has demos or quotations switched on. */
  noDemoVerticals: boolean
}

export async function loadDemos(scope: AnalyticsScope): Promise<DemosReport> {
  const verticals = await verticalsWithStages()

  const demoVerticals = verticals.filter(
    (vertical) =>
      (vertical.usesDemos || vertical.usesQuotations) &&
      (scope.verticalId === null || vertical.id === scope.verticalId),
  )

  if (demoVerticals.length === 0) {
    return {
      rows: [],
      totals: {
        inquiries: 0,
        scheduled: 0,
        completed: 0,
        won: 0,
        orderValue: 0,
        averageOrderValue: null,
      },
      byStatus: [],
      noDemoVerticals: true,
    }
  }

  // Every query below narrows to these verticals. The scope's own single-vertical
  // filter is already folded into `demoVerticals` above, so this both restricts
  // the report to verticals that use demos and honours the filter bar.
  const ids = demoVerticals.map((vertical) => vertical.id)

  const [
    inquiries,
    demos,
    leadsWithDemo,
    leadsWithCompleted,
    quotations,
    proposals,
    negotiations,
    wins,
  ] = await Promise.all([
    prisma.lead.groupBy({
      by: ['verticalId'],
      where: { ...leadsCreatedWhere(scope), verticalId: { in: ids } },
      _count: { _all: true },
    }),
    // Demos are dated by when they were *scheduled*, every status included, so
    // that "scheduled" and "completed" are two readings of one set of rows and
    // the conversion between them means something. A demo scheduled in July and
    // completed in August counts in July on both columns — stated on screen.
    //
    // Grouped by vertical *and* status in SQL: Prisma's `groupBy` cannot reach the
    // vertical through the lead relation, so this one is raw — see
    // `src/lib/reports/aggregate.ts`.
    demoCountsByVertical(scope, ids),
    prisma.lead.groupBy({
      by: ['verticalId'],
      where: {
        ...leadsCreatedWhere(scope),
        verticalId: { in: ids },
        demos: { some: {} },
      },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ['verticalId'],
      where: {
        ...leadsCreatedWhere(scope),
        verticalId: { in: ids },
        demos: { some: { status: 'COMPLETED' } },
      },
      _count: { _all: true },
    }),
    // Order Value per §4.6: accepted quotations, dated by the quote itself. An
    // accepted quote is the moment an order exists in Product Sales, which is
    // also what fills the lead's deal value (Phase 5). Summed in cents inside
    // Postgres so the total is exact.
    acceptedQuotationCentsByVertical(scope, ids),
    reachedGrouped(scope, 'PROPOSAL', 'verticalId'),
    reachedGrouped(scope, 'NEGOTIATION', 'verticalId'),
    reachedGrouped(scope, 'WON', 'verticalId'),
  ])

  const inquiryCounts = new Map(
    inquiries.map((row) => [row.verticalId, row._count._all]),
  )
  const withDemo = new Map(
    leadsWithDemo.map((row) => [row.verticalId, row._count._all]),
  )
  const withCompleted = new Map(
    leadsWithCompleted.map((row) => [row.verticalId, row._count._all]),
  )

  const scheduledByVertical = new Map<string, number>()
  const completedByVertical = new Map<string, number>()

  const byStatus = new Map<DemoStatus, number>()

  for (const row of demos) {
    const id = row.verticalId
    scheduledByVertical.set(id, (scheduledByVertical.get(id) ?? 0) + row.count)
    if (row.status === 'COMPLETED') {
      completedByVertical.set(id, (completedByVertical.get(id) ?? 0) + row.count)
    }
    const status = row.status as DemoStatus
    byStatus.set(status, (byStatus.get(status) ?? 0) + row.count)
  }

  const orderCents = quotations

  const rows: DemoVerticalRow[] = demoVerticals.map((vertical) => {
    const inquiryCount = inquiryCounts.get(vertical.id) ?? 0
    const scheduled = scheduledByVertical.get(vertical.id) ?? 0
    const completed = completedByVertical.get(vertical.id) ?? 0
    const withDemoCount = withDemo.get(vertical.id) ?? 0
    const withCompletedCount = withCompleted.get(vertical.id) ?? 0
    const reachedProposal = proposals.get(vertical.id) ?? 0
    const reachedNegotiation = negotiations.get(vertical.id) ?? 0
    const won = wins.get(vertical.id) ?? 0
    const orderValue = fromCents(orderCents.get(vertical.id) ?? 0)

    return {
      verticalId: vertical.id,
      vertical: vertical.name,
      inquiries: inquiryCount,
      scheduled,
      completed,
      leadsWithDemo: withDemoCount,
      leadsWithCompletedDemo: withCompletedCount,
      reachedProposal,
      reachedNegotiation,
      won,
      orderValue,
      // Average order value divides by *won leads*, per §4.6 — not by the number
      // of accepted quotations, which would answer "average quote" instead.
      averageOrderValue: won > 0 ? orderValue / won : null,
      inquiryToDemo: rate(withDemoCount, inquiryCount),
      demoToProposal: rate(reachedProposal, withCompletedCount),
      negotiationToWon: rate(won, reachedNegotiation),
      inquiryToWon: rate(won, inquiryCount),
    }
  })

  const totals = rows.reduce(
    (carry, row) => ({
      inquiries: carry.inquiries + row.inquiries,
      scheduled: carry.scheduled + row.scheduled,
      completed: carry.completed + row.completed,
      won: carry.won + row.won,
      orderValue: carry.orderValue + row.orderValue,
      averageOrderValue: null as number | null,
    }),
    {
      inquiries: 0,
      scheduled: 0,
      completed: 0,
      won: 0,
      orderValue: 0,
      averageOrderValue: null as number | null,
    },
  )

  totals.averageOrderValue =
    totals.won > 0 ? totals.orderValue / totals.won : null

  return {
    rows,
    totals,
    // Kept because a no-show is not a completed demo and not a cancelled one
    // either, and the difference is what a demo team is judged on.
    byStatus: [...byStatus].sort((a, b) => b[1] - a[1]),
    noDemoVerticals: false,
  }
}
