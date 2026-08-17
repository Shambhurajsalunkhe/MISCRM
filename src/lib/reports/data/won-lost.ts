import 'server-only'

import { prisma } from '@/lib/db'
import { fromCents, toCents } from '@/lib/commercials/money'
import { leadsClosedWhere, type AnalyticsScope } from '@/lib/reports/filters'
import { revenueTotals } from '@/lib/reports/kpis'
import type { LeadStatus } from '@/generated/prisma/enums'

/**
 * Won / Lost analysis with the lost-reason breakdown (README §29).
 *
 * The one report on the list that is dated by **when a deal was decided** rather
 * than when it arrived: `closedAt`, written by the stage engine the moment a lead
 * reaches a winning or losing stage. That is deliberately different from the
 * dashboard's cohort counts, and both screens say which they are — "12 won in
 * August" and "12 of August's leads have been won" are different sentences, and
 * a report that quietly answered the second when asked the first is how a sales
 * review ends in an argument about the numbers rather than about the deals.
 *
 * The lost reasons are the point of the report. They are master data, global or
 * per vertical, and a lead can be lost without one — so "no reason recorded" is a
 * row here rather than a silent omission. It is usually the row worth acting on.
 */

/** Bound on the cycle-time read. See the comment where it is used. */
const CYCLE_SAMPLE = 2_000

export type WonLostReport = {
  won: number
  lost: number
  /** `won ÷ (won + lost)`, over deals decided in the period. */
  winRate: number | null
  /** Won revenue on the shared definition — deal value, or placements for Staffing. */
  wonValue: number
  lostValue: number
  byVertical: Array<{
    verticalId: string
    won: number
    lost: number
    winRate: number | null
  }>
  reasons: Array<{
    id: string | null
    name: string
    count: number
    share: number
    value: number
  }>
  /** Average days from creation to close, won and lost separately. */
  cycle: { won: number | null; lost: number | null; sampled: number; capped: boolean }
}

export async function loadWonLost(
  scope: AnalyticsScope,
): Promise<WonLostReport> {
  // Every query here starts from "closed in the period", with the scope's own
  // status filter respected where it narrows further. Shared with the rest of the
  // analytics code rather than rebuilt, so "decided in this period" cannot come
  // to mean two things.
  const closed = leadsClosedWhere(scope)

  const [byStatus, byVerticalRows, reasonRows, reasonNames, sample, revenue] =
    await Promise.all([
      prisma.lead.groupBy({
        by: ['status'],
        where: closed,
        _count: { _all: true },
        _sum: { dealValue: true, expectedBudget: true },
      }),
      prisma.lead.groupBy({
        by: ['verticalId', 'status'],
        where: closed,
        _count: { _all: true },
      }),
      prisma.lead.groupBy({
        by: ['lostReasonId'],
        where: { ...closed, status: 'LOST' },
        _count: { _all: true },
        _sum: { expectedBudget: true },
      }),
      prisma.lostReason.findMany({ select: { id: true, name: true } }),
      // Cycle time is an average over instants, which Prisma cannot aggregate
      // across two columns. Read rather than computed in SQL, capped, and the
      // report says when the cap bit — an average of the two thousand most
      // recent closes is still a useful number, and a silent truncation would
      // not be.
      prisma.lead.findMany({
        where: closed,
        select: { status: true, createdAt: true, closedAt: true },
        orderBy: { closedAt: 'desc' },
        take: CYCLE_SAMPLE + 1,
      }),
      // Won value comes from the *shared* revenue definition rather than from a
      // `SUM(dealValue)` of its own. Decision D8 puts a staffing deal's value on
      // its placements, so summing deal value here would have reported a won
      // staffing account as worth nothing while the revenue report showed the
      // placements — two screens disagreeing about "won value" is precisely the
      // reconciliation this phase exists to end.
      revenueTotals(scope),
    ])

  const counts = new Map(
    byStatus.map((row) => [row.status, row._count._all] as const),
  )
  const won = counts.get('WON') ?? 0
  const lost = counts.get('LOST') ?? 0

  // Lost deals rarely have a deal value — nothing was agreed — so what was at
  // stake is the expected budget. Labelled as such on the screen: it is the size
  // of the opportunity, not money that was lost.
  const lostValueCents = toCents(
    byStatus.find((row) => row.status === 'LOST')?._sum.expectedBudget,
  )

  const verticalTotals = new Map<string, { won: number; lost: number }>()
  for (const row of byVerticalRows) {
    const bucket = verticalTotals.get(row.verticalId) ?? { won: 0, lost: 0 }
    if (row.status === 'WON') bucket.won += row._count._all
    if (row.status === 'LOST') bucket.lost += row._count._all
    verticalTotals.set(row.verticalId, bucket)
  }

  const names = new Map(reasonNames.map((row) => [row.id, row.name]))
  const lostTotal = reasonRows.reduce((sum, row) => sum + row._count._all, 0)

  const capped = sample.length > CYCLE_SAMPLE
  const sampled = capped ? sample.slice(0, CYCLE_SAMPLE) : sample

  const cycleFor = (status: LeadStatus): number | null => {
    const days = sampled
      .filter((lead) => lead.status === status && lead.closedAt)
      .map(
        (lead) =>
          (lead.closedAt!.getTime() - lead.createdAt.getTime()) / 86_400_000,
      )
    if (days.length === 0) return null
    return days.reduce((a, b) => a + b, 0) / days.length
  }

  return {
    won,
    lost,
    winRate: won + lost > 0 ? (won / (won + lost)) * 100 : null,
    wonValue: revenue.totals.won,
    lostValue: fromCents(lostValueCents),
    byVertical: [...verticalTotals]
      .map(([verticalId, bucket]) => ({
        verticalId,
        ...bucket,
        winRate:
          bucket.won + bucket.lost > 0
            ? (bucket.won / (bucket.won + bucket.lost)) * 100
            : null,
      }))
      .sort((a, b) => b.won + b.lost - (a.won + a.lost)),
    reasons: reasonRows
      .map((row) => ({
        id: row.lostReasonId,
        name: row.lostReasonId
          ? (names.get(row.lostReasonId) ?? 'Retired reason')
          : 'No reason recorded',
        count: row._count._all,
        share: lostTotal > 0 ? (row._count._all / lostTotal) * 100 : 0,
        value: fromCents(toCents(row._sum.expectedBudget)),
      }))
      .sort((a, b) => b.count - a.count),
    cycle: {
      won: cycleFor('WON'),
      lost: cycleFor('LOST'),
      sampled: sampled.length,
      capped,
    },
  }
}
