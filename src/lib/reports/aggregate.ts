import 'server-only'

import { prisma } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import {
  instants,
  leadFacts,
  type AnalyticsScope,
} from '@/lib/reports/filters'
import {
  localDayStart,
  type PeopleScope,
  type ResolvedRange,
} from '@/lib/prospecting/filters'
import { addDays } from '@/lib/prospecting/dates'
import type { CommonStage } from '@/generated/prisma/enums'

/**
 * `reached()` as a real aggregate, at all three levels.
 *
 * Phases 3 and 4 built these by fetching every distinct `(stage, record)` pair
 * in the period and counting them in memory. Correct, indexed on the transition
 * date, and fine for one vertical on one screen — but the dashboard asks the
 * same question for eight verticals at once, several times per render, and the
 * plan flagged this as the phase where all three get converted together.
 *
 * They are raw SQL because the counts are `COUNT(DISTINCT leadId)` grouped by
 * stage, which Prisma's `groupBy` cannot express: `by: ['toStageId', 'leadId']`
 * returns exactly the pair-per-row shape we are trying to get away from. The
 * `where` fragments are composed with `Prisma.sql`, so every filter value is a
 * bound parameter and none of it is string-concatenated.
 *
 * Why `DISTINCT` matters: a lead pushed back to Negotiation and forward again
 * has two history rows for that stage and is still one lead. And why these count
 * transitions rather than current stage: decision D12 — a lead that went
 * Requirement Gathering → Negotiation → Won counts once in each of the three.
 */

/** `WHERE` fragment for the lead side of a history query, from a report scope. */
function leadScopeSql(scope: AnalyticsScope): Prisma.Sql {
  const clauses: Prisma.Sql[] = [Prisma.sql`l."isDeleted" = false`]

  if (scope.verticalId) clauses.push(Prisma.sql`l."verticalId" = ${scope.verticalId}`)
  if (scope.sourceId) clauses.push(Prisma.sql`l."sourceId" = ${scope.sourceId}`)
  if (scope.bde) clauses.push(Prisma.sql`l."generatedById" = ${scope.bde}`)
  if (scope.bdm) clauses.push(Prisma.sql`l."assignedToId" = ${scope.bdm}`)
  if (scope.teamId) clauses.push(Prisma.sql`l."teamId" = ${scope.teamId}`)
  if (scope.status) clauses.push(Prisma.sql`l."status" = ${scope.status}::"LeadStatus"`)
  if (scope.priority) clauses.push(Prisma.sql`l."priority" = ${scope.priority}::"Priority"`)

  // An empty array is not the same as no restriction: `= ANY('{}')` is false for
  // every row, which is the right answer for a user who may see nobody.
  if (scope.visible) {
    clauses.push(
      Prisma.sql`(l."generatedById" = ANY(${scope.visible}::text[]) OR l."assignedToId" = ANY(${scope.visible}::text[]))`,
    )
  }

  return Prisma.join(clauses, ' AND ')
}

/**
 * The same fragment from a `PeopleScope` — what the funnel and the staffing
 * report carry. Only the people filters apply: a history row is dated by its own
 * `changedAt`, so the period is expressed on the history table and not here.
 */
function leadPeopleSql(people: PeopleScope): Prisma.Sql {
  const clauses: Prisma.Sql[] = [Prisma.sql`l."isDeleted" = false`]

  if (people.only) clauses.push(Prisma.sql`l."generatedById" = ${people.only}`)
  if (people.teamId) clauses.push(Prisma.sql`l."teamId" = ${people.teamId}`)
  if (people.visible) {
    clauses.push(
      Prisma.sql`(l."generatedById" = ANY(${people.visible}::text[]) OR l."assignedToId" = ANY(${people.visible}::text[]))`,
    )
  }

  return Prisma.join(clauses, ' AND ')
}

/** Requirement-side scope, mirroring `requirementScope` in the staffing metrics. */
function requirementPeopleSql(people: PeopleScope): Prisma.Sql {
  const clauses: Prisma.Sql[] = [Prisma.sql`r."isDeleted" = false`]

  if (people.only) clauses.push(Prisma.sql`r."assignedToId" = ${people.only}`)
  if (people.teamId) clauses.push(Prisma.sql`l."teamId" = ${people.teamId}`)
  if (people.visible) {
    clauses.push(
      Prisma.sql`(r."assignedToId" = ANY(${people.visible}::text[]) OR l."generatedById" = ANY(${people.visible}::text[]) OR l."assignedToId" = ANY(${people.visible}::text[]))`,
    )
  }

  return Prisma.join(clauses, ' AND ')
}

/** The half-open instant range for a `PeopleScope`-shaped call. */
function period(range: ResolvedRange) {
  return {
    from: localDayStart(range.from),
    to: localDayStart(addDays(range.to, 1)),
  }
}

type CountRow = { key: string | null; count: number }

function toMap(rows: CountRow[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (row.key !== null) counts.set(row.key, Number(row.count))
  }
  return counts
}

// ---------------------------------------------------------------------------
// Lead level
// ---------------------------------------------------------------------------

/** `reached()` per pipeline stage of one vertical, for a `PeopleScope`. */
export async function reachedByStageAggregate(
  range: ResolvedRange,
  people: PeopleScope,
  verticalId: string,
): Promise<Map<string, number>> {
  const { from, to } = period(range)

  const rows = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT h."toStageId" AS key, COUNT(DISTINCT h."leadId")::int AS count
    FROM "LeadStageHistory" h
    JOIN "Lead" l ON l."id" = h."leadId"
    JOIN "PipelineStage" s ON s."id" = h."toStageId"
    WHERE h."changedAt" >= ${from}
      AND h."changedAt" < ${to}
      AND s."verticalId" = ${verticalId}
      AND ${leadPeopleSql(people)}
    GROUP BY 1
  `)

  return toMap(rows)
}

/**
 * Leads that reached each common stage in the period, across every vertical.
 *
 * This is the Pipeline Overview on the dashboard (docs/03 §1): one row per
 * bucket of decision D5's shared layer, which is what makes a chart spanning
 * eight different stage lists possible at all.
 */
export async function reachedByCommonStage(
  scope: AnalyticsScope,
): Promise<Map<CommonStage, number>> {
  const { gte, lt } = instants(scope.range)

  const rows = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT h."toCommonStage"::text AS key, COUNT(DISTINCT h."leadId")::int AS count
    FROM "LeadStageHistory" h
    JOIN "Lead" l ON l."id" = h."leadId"
    WHERE h."changedAt" >= ${gte}
      AND h."changedAt" < ${lt}
      AND ${leadScopeSql(scope)}
    GROUP BY 1
  `)

  return toMap(rows) as Map<CommonStage, number>
}

/**
 * The lead columns a report may group by.
 *
 * A closed list, not a string parameter: this is the one value in these queries
 * that becomes SQL text rather than a bound parameter, so it can only ever be
 * one of five names the type checker knows. `generatedById` and `assignedToId`
 * are both here because the two are genuinely different questions — BDE Lead
 * Generation credits whoever *generated* the lead (README §27), BDM Conversion
 * whoever it is *assigned to* (README §28) — and counting either with the
 * other's column is the one mistake those two reports can make.
 */
export const GROUP_COLUMNS = {
  verticalId: '"verticalId"',
  sourceId: '"sourceId"',
  generatedById: '"generatedById"',
  assignedToId: '"assignedToId"',
  teamId: '"teamId"',
} as const

export type GroupColumn = keyof typeof GROUP_COLUMNS

/**
 * Leads that reached one common stage in the period, grouped by any of those
 * columns.
 *
 * Every "won in this period" figure on the dashboard and the reports comes
 * through here rather than off `Lead.status`, so a deal won in August counts in
 * August whenever it was created — the same rule the funnel follows. Asking one
 * group at a time would be eight queries where this is one.
 */
export async function reachedGrouped(
  scope: AnalyticsScope,
  common: CommonStage,
  by: GroupColumn,
): Promise<Map<string, number>> {
  const { gte, lt } = instants(scope.range)

  const rows = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT COALESCE(l.${Prisma.raw(GROUP_COLUMNS[by])}, '') AS key, COUNT(DISTINCT h."leadId")::int AS count
    FROM "LeadStageHistory" h
    JOIN "Lead" l ON l."id" = h."leadId"
    WHERE h."changedAt" >= ${gte}
      AND h."changedAt" < ${lt}
      AND h."toCommonStage" = ${common}::"CommonStage"
      AND ${leadScopeSql(scope)}
    GROUP BY 1
  `)

  return toMap(rows)
}

/** `reachedGrouped` by vertical — the Conversion by Vertical table's Won column. */
export function reachedByVertical(
  scope: AnalyticsScope,
  common: CommonStage,
): Promise<Map<string, number>> {
  return reachedGrouped(scope, common, 'verticalId')
}

/**
 * Average hours spent in each stage before leaving it (docs/02 §6).
 *
 * `hoursInPreviousStage` is written by the stage engine on every transition, so
 * this is an average over completed stays only — a lead still sitting in
 * Negotiation contributes nothing until it moves. That is the honest reading for
 * a bottleneck report ("when leads do get out of here, how long did it take"),
 * and it is why the aging report shows the count of transitions beside each
 * average: an average of two is a rumour, not a bottleneck.
 */
export async function averageHoursByStage(
  scope: AnalyticsScope,
): Promise<Map<string, { hours: number; transitions: number }>> {
  const { gte, lt } = instants(scope.range)

  const rows = await prisma.$queryRaw<
    Array<{ key: string | null; hours: number | null; transitions: number }>
  >(Prisma.sql`
    SELECT h."fromStageId" AS key,
           AVG(h."hoursInPreviousStage")::float8 AS hours,
           COUNT(*)::int AS transitions
    FROM "LeadStageHistory" h
    JOIN "Lead" l ON l."id" = h."leadId"
    WHERE h."changedAt" >= ${gte}
      AND h."changedAt" < ${lt}
      AND h."fromStageId" IS NOT NULL
      AND h."hoursInPreviousStage" IS NOT NULL
      AND ${leadScopeSql(scope)}
    GROUP BY 1
  `)

  const out = new Map<string, { hours: number; transitions: number }>()
  for (const row of rows) {
    if (row.key === null) continue
    out.set(row.key, {
      hours: Number(row.hours ?? 0),
      transitions: Number(row.transitions),
    })
  }
  return out
}

/**
 * Leads currently sitting in each stage — `currentlyAt()` of docs/02 §4.
 *
 * Unlike everything above, this is a plain count on `Lead.currentStageId` and
 * ignores the date range: "what is in the pipeline now" does not become a
 * different number because the report was narrowed to last month. Used by the
 * aging report, which is only ever about the present.
 */
export async function currentlyAtStage(
  scope: AnalyticsScope,
): Promise<Map<string, number>> {
  const rows = await prisma.lead.groupBy({
    by: ['currentStageId'],
    where: { ...leadFacts(scope), status: 'OPEN' },
    _count: { _all: true },
  })

  const counts = new Map<string, number>()
  for (const row of rows) {
    if (row.currentStageId) counts.set(row.currentStageId, row._count._all)
  }
  return counts
}

// ---------------------------------------------------------------------------
// Product Sales
// ---------------------------------------------------------------------------

/**
 * Demos in the period, grouped by vertical *and* status.
 *
 * Raw SQL for the same reason the `reached()` family is: the product-demos report
 * needs the split two ways at once, and the vertical lives on the lead, which
 * Prisma's `groupBy` cannot reach through. Reading the rows and counting them in
 * memory worked, but it was the one read in this phase with no bound on it at
 * all — a busy quarter of demos would have been pulled into the process to
 * produce a table of eight numbers.
 */
export async function demoCountsByVertical(
  scope: AnalyticsScope,
  verticalIds: string[],
): Promise<Array<{ verticalId: string; status: string; count: number }>> {
  if (verticalIds.length === 0) return []
  const { gte, lt } = instants(scope.range)

  const rows = await prisma.$queryRaw<
    Array<{ key: string; status: string; count: number }>
  >(Prisma.sql`
    SELECT l."verticalId" AS key, d."status"::text AS status, COUNT(*)::int AS count
    FROM "Demo" d
    JOIN "Lead" l ON l."id" = d."leadId"
    WHERE d."scheduledAt" >= ${gte}
      AND d."scheduledAt" < ${lt}
      AND l."verticalId" = ANY(${verticalIds}::text[])
      AND ${leadScopeSql(scope)}
    GROUP BY 1, 2
  `)

  return rows.map((row) => ({
    verticalId: row.key,
    status: row.status,
    count: Number(row.count),
  }))
}

/**
 * Accepted quotation value per vertical — Order Value of docs/02 §4.6.
 *
 * Summed in **cents inside Postgres**, not as a float: `SUM` over a `numeric`
 * column is exact, and multiplying the exact sum by a hundred before casting to
 * an integer keeps it exact all the way into JavaScript. Casting to `float8`
 * would have handed back the rounding error `src/lib/commercials/money.ts` exists
 * to prevent, in the one place where nobody would think to look for it.
 */
export async function acceptedQuotationCentsByVertical(
  scope: AnalyticsScope,
  verticalIds: string[],
): Promise<Map<string, number>> {
  if (verticalIds.length === 0) return new Map()
  const { gte, lt } = instants(scope.range)

  const rows = await prisma.$queryRaw<
    Array<{ key: string; cents: bigint | string | number }>
  >(
    Prisma.sql`
      SELECT l."verticalId" AS key,
             (COALESCE(SUM(q."totalAmount"), 0) * 100)::bigint AS cents
      FROM "Quotation" q
      JOIN "Lead" l ON l."id" = q."leadId"
      WHERE q."status" = 'ACCEPTED'::"QuotationStatus"
        AND q."quoteDate" >= ${gte}
        AND q."quoteDate" < ${lt}
        AND l."verticalId" = ANY(${verticalIds}::text[])
        AND ${leadScopeSql(scope)}
      GROUP BY 1
    `,
  )

  // The driver hands `bigint` back as a JS BigInt (a string on some versions);
  // `Number` converts either, and the column tops out far below 2^53 cents.
  return new Map(rows.map((row) => [row.key, Number(row.cents)]))
}

// ---------------------------------------------------------------------------
// Requirement and submission levels
// ---------------------------------------------------------------------------

/** `reached()` per requirement stage — the Phase 4 in-memory count, aggregated. */
export async function requirementReachedAggregate(
  range: ResolvedRange,
  people: PeopleScope,
): Promise<Map<string, number>> {
  const { from, to } = period(range)

  const rows = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT h."toStageId" AS key, COUNT(DISTINCT h."requirementId")::int AS count
    FROM "RequirementStageHistory" h
    JOIN "Requirement" r ON r."id" = h."requirementId"
    JOIN "Lead" l ON l."id" = r."leadId"
    WHERE h."changedAt" >= ${from}
      AND h."changedAt" < ${to}
      AND ${requirementPeopleSql(people)}
    GROUP BY 1
  `)

  return toMap(rows)
}

/** `subReached()` per candidate stage, same conversion one level further down. */
export async function subReachedAggregate(
  range: ResolvedRange,
  people: PeopleScope,
): Promise<Map<string, number>> {
  const { from, to } = period(range)

  const rows = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT h."toStageId" AS key, COUNT(DISTINCT h."submissionId")::int AS count
    FROM "CandidateStageHistory" h
    JOIN "CandidateSubmission" cs ON cs."id" = h."submissionId"
    JOIN "Requirement" r ON r."id" = cs."requirementId"
    JOIN "Lead" l ON l."id" = r."leadId"
    WHERE h."changedAt" >= ${from}
      AND h."changedAt" < ${to}
      AND ${requirementPeopleSql(people)}
    GROUP BY 1
  `)

  return toMap(rows)
}
