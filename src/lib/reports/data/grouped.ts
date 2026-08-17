import 'server-only'

import { prisma } from '@/lib/db'
import { fromCents, toCents } from '@/lib/commercials/money'
import { reachedGrouped, type GroupColumn } from '@/lib/reports/aggregate'
import {
  instants,
  leadFacts,
  leadsCreatedWhere,
  openPipelineWhere,
  type AnalyticsScope,
} from '@/lib/reports/filters'
import { conversion, type LeadCounts } from '@/lib/reports/kpis'
import type { CommonStage, LeadStatus } from '@/generated/prisma/enums'

/**
 * "The same six numbers, grouped by X."
 *
 * Four of the eleven reports ask one question of different columns — Vertical
 * Performance (§25), Lead Source Performance, BDE Lead Generation (§27) and BDM
 * Conversion (§28) — and all four want leads, outcomes, conversion, pipeline
 * value and won revenue per group. Writing them separately would be four
 * chances for "conversion" to mean four things, which is precisely what the
 * Sales Head is currently using spreadsheets to reconcile.
 *
 * So the grouping column is a parameter and the reports differ only in what they
 * label the column and what they add beside it: the BDE report adds prospecting
 * counters above the line, the BDM report adds the stage progression below it.
 *
 * The empty string is the "no value" group — leads with no source, no team or no
 * assignee. It is a real answer worth showing: a source list where a third of
 * the leads have no source recorded is the finding, not a rounding error.
 */

export const UNGROUPED = ''

export type GroupedRow = {
  key: string
  counts: LeadCounts
  /** `SUM(COALESCE(dealValue, expectedBudget))` over this group's open leads. */
  pipeline: number
  /** Won revenue booked in the period, per docs/02 §5's two rules. */
  wonRevenue: number
  /** Leads that reached each requested common stage in the period. */
  reached: Partial<Record<CommonStage, number>>
  conversion: number | null
}

const EMPTY: LeadCounts = { total: 0, open: 0, won: 0, lost: 0 }

/**
 * The lead columns whose group ids need looking up for a label. Kept beside the
 * loader so a report cannot group by one column and label with another.
 */
export async function groupLabels(
  by: GroupColumn,
  keys: string[],
): Promise<Map<string, string>> {
  const ids = keys.filter((key) => key !== UNGROUPED)
  if (ids.length === 0) return new Map()

  const rows =
    by === 'verticalId'
      ? await prisma.salesVertical.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : by === 'sourceId'
        ? await prisma.leadSource.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true },
          })
        : by === 'teamId'
          ? await prisma.team.findMany({
              where: { id: { in: ids } },
              select: { id: true, name: true },
            })
          : await prisma.user.findMany({
              where: { id: { in: ids } },
              select: { id: true, name: true },
            })

  return new Map(rows.map((row) => [row.id, row.name]))
}

export async function groupedPerformance(
  scope: AnalyticsScope,
  by: GroupColumn,
  stages: CommonStage[] = ['WON'],
): Promise<GroupedRow[]> {
  const facts = leadFacts(scope)
  const period = instants(scope.range)

  const [statusRows, openLeads, closedWon, placements, ...reachedMaps] =
    await Promise.all([
      // `by` is a key of the delegate's groupBy union; TypeScript cannot see
      // that through a variable, hence the assertion. The five permitted values
      // are the closed `GROUP_COLUMNS` list, so this cannot become a column that
      // does not exist.
      prisma.lead.groupBy({
        by: [by, 'status'] as never,
        where: leadsCreatedWhere(scope),
        _count: { _all: true },
      }) as unknown as Promise<
        Array<Record<string, unknown> & { status: LeadStatus; _count: { _all: number } }>
      >,
      prisma.lead.findMany({
        where: openPipelineWhere(scope),
        select: {
          verticalId: true,
          sourceId: true,
          generatedById: true,
          assignedToId: true,
          teamId: true,
          dealValue: true,
          expectedBudget: true,
        },
      }),
      prisma.lead.findMany({
        where: { ...facts, status: 'WON', closedAt: period },
        select: {
          verticalId: true,
          sourceId: true,
          generatedById: true,
          assignedToId: true,
          teamId: true,
          dealValue: true,
          vertical: { select: { usesRequirements: true } },
        },
      }),
      prisma.placement.findMany({
        where: { joiningDate: period, reversedAt: null, lead: facts },
        select: {
          placementValue: true,
          lead: {
            select: {
              verticalId: true,
              sourceId: true,
              generatedById: true,
              assignedToId: true,
              teamId: true,
            },
          },
        },
      }),
      ...stages.map((stage) => reachedGrouped(scope, stage, by)),
    ])

  const rows = new Map<string, GroupedRow>()

  const row = (key: string): GroupedRow => {
    const existing = rows.get(key)
    if (existing) return existing

    const created: GroupedRow = {
      key,
      counts: { ...EMPTY },
      pipeline: 0,
      wonRevenue: 0,
      reached: {},
      conversion: null,
    }
    rows.set(key, created)
    return created
  }

  const groupOf = (record: Record<string, unknown>): string =>
    (record[by] as string | null) ?? UNGROUPED

  for (const record of statusRows) {
    const target = row(groupOf(record))
    const count = record._count._all
    target.counts.total += count
    if (record.status === 'OPEN') target.counts.open += count
    if (record.status === 'WON') target.counts.won += count
    if (record.status === 'LOST') target.counts.lost += count
  }

  // Money is accumulated in cents and converted once per group at the end, for
  // the reason src/lib/commercials/money.ts exists.
  const pipelineCents = new Map<string, number>()
  const wonCents = new Map<string, number>()

  for (const lead of openLeads) {
    const key = groupOf(lead)
    pipelineCents.set(
      key,
      (pipelineCents.get(key) ?? 0) + toCents(lead.dealValue ?? lead.expectedBudget),
    )
    row(key)
  }

  for (const lead of closedWon) {
    // Staffing's won value lives on its placements (decision D8), so a staffing
    // lead's `dealValue` is deliberately not counted here — it would either be
    // blank or a stale duplicate of the placements below.
    if (lead.vertical.usesRequirements) continue
    const key = groupOf(lead)
    wonCents.set(key, (wonCents.get(key) ?? 0) + toCents(lead.dealValue))
    row(key)
  }

  for (const placement of placements) {
    const key = groupOf(placement.lead)
    wonCents.set(key, (wonCents.get(key) ?? 0) + toCents(placement.placementValue))
    row(key)
  }

  stages.forEach((stage, index) => {
    for (const [key, count] of reachedMaps[index] ?? new Map()) {
      row(key).reached[stage] = count
    }
  })

  for (const [key, target] of rows) {
    target.pipeline = fromCents(pipelineCents.get(key) ?? 0)
    target.wonRevenue = fromCents(wonCents.get(key) ?? 0)
    target.conversion = conversion(target.counts)
  }

  return [...rows.values()].sort(
    (a, b) => b.counts.total - a.counts.total || b.pipeline - a.pipeline,
  )
}

/** Counter totals per person, for the BDE report's above-the-line columns. */
export async function counterTotalsByPerson(
  scope: AnalyticsScope,
): Promise<Map<string, number>> {
  const rows = await prisma.prospectingActivity.groupBy({
    by: ['userId'],
    where: {
      activityDate: { gte: scope.range.from, lte: scope.range.to },
      ...(scope.verticalId ? { verticalId: scope.verticalId } : {}),
      // The person filter here is `bde`: a counter is logged *by* somebody, and
      // "assigned to" has no meaning above the line.
      ...(scope.bde
        ? { userId: scope.bde }
        : scope.visible
          ? { userId: { in: scope.visible } }
          : {}),
      ...(scope.teamId ? { user: { teamId: scope.teamId } } : {}),
    },
    _sum: { count: true },
  })

  return new Map(rows.map((row) => [row.userId, row._sum.count ?? 0]))
}
