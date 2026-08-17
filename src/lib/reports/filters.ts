import 'server-only'

import { visibleUserIds } from '@/lib/visibility'
import {
  localDayStart,
  resolveRange,
  type PeopleScope,
  type ResolvedRange,
} from '@/lib/prospecting/filters'
import { addDays } from '@/lib/prospecting/dates'
import { COMMON_STAGE_ORDER, PRIORITY_ORDER } from '@/lib/leads/display'
import type { CurrentUser } from '@/lib/auth/session'
import type {
  CommonStage,
  LeadStatus,
  Priority,
} from '@/generated/prisma/enums'

/**
 * The filter set the dashboard and every report share (docs/03 §1, README §37).
 *
 * One parser, one scope object, one set of `where` builders, used by the
 * dashboard, the nine reports and their exports. The reason it is shared rather
 * than per-screen is the drill-down chain: a KPI card has to hand the *exact*
 * filter set that produced it to the vertical breakdown, which hands it to the
 * lead list. Three implementations of "August, Upwork, Rahul's leads" is three
 * chances for the number on the card and the rows behind it to disagree.
 *
 * The keys are deliberately the same strings `/leads` already parses — `bde`,
 * `bdm`, `team`, `vertical`, `source`, `status`, `priority`, `from`, `to` — so
 * drilling through is a query string that carries over verbatim rather than a
 * translation table between two vocabularies. `src/lib/prospecting/filters.ts`
 * keeps its narrower set (it calls the person filter `user`, because a counter
 * has one person and not a generator and an owner); the date half is identical
 * and `resolveRange` is reused rather than reimplemented.
 */

export const ANALYTICS_FILTER_KEYS = [
  'from',
  'to',
  'vertical',
  'source',
  'bde',
  'bdm',
  'team',
  'status',
  'priority',
] as const

export type AnalyticsFilters = Partial<
  Record<(typeof ANALYTICS_FILTER_KEYS)[number], string>
>

export function pickAnalyticsFilters(
  params: Record<string, string | string[] | undefined>,
): AnalyticsFilters {
  const filters: AnalyticsFilters = {}

  for (const key of ANALYTICS_FILTER_KEYS) {
    const value = params[key]
    const single = Array.isArray(value) ? value[0] : value
    if (typeof single === 'string' && single.trim() !== '') {
      filters[key] = single.trim()
    }
  }

  return filters
}

/**
 * The filter state as a query string, for a link from one report to another.
 *
 * `extra` is appended for the parameters a link adds rather than carries — the
 * common stage a pipeline bar drills into, say, which is not a filter of the
 * screen the user is leaving.
 */
export function analyticsQuery(
  filters: AnalyticsFilters,
  extra?: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams()

  for (const key of ANALYTICS_FILTER_KEYS) {
    const value = filters[key]
    if (value) params.set(key, value)
  }

  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value) params.set(key, value)
  }

  return params.toString()
}

function isOneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): value is T {
  return value !== undefined && (allowed as readonly string[]).includes(value)
}

/**
 * Everything a report needs to know about *what it is being asked for*.
 *
 * `visible` is the data scope of decision D7 — `null` meaning no restriction —
 * and `bde`/`bdm` are the explicit person filters, each re-checked against that
 * scope. Without the re-check, picking a name from the dropdown would be a way
 * to read another team's numbers: the select is a convenience, this is the
 * control. Same rule as `resolvePeople` in the prospecting filters.
 *
 * The enum filters are parsed rather than passed through, so a hand-typed
 * `?status=WHATEVER` is ignored instead of reaching Prisma as an invalid enum
 * and coming back as "something went wrong".
 */
export type AnalyticsScope = {
  filters: AnalyticsFilters
  range: ResolvedRange
  visible: string[] | null
  bde: string | null
  bdm: string | null
  teamId: string | null
  verticalId: string | null
  sourceId: string | null
  status: LeadStatus | null
  priority: Priority | null
}

export async function resolveAnalytics(
  user: CurrentUser,
  params: Record<string, string | string[] | undefined>,
): Promise<AnalyticsScope> {
  const filters = pickAnalyticsFilters(params)
  const visible = await visibleUserIds(user)

  const inScope = (id: string | undefined) =>
    id && (visible === null || visible.includes(id)) ? id : null

  return {
    filters,
    range: resolveRange(filters),
    visible,
    bde: inScope(filters.bde),
    bdm: inScope(filters.bdm),
    teamId: filters.team ?? null,
    verticalId: filters.vertical ?? null,
    sourceId: filters.source ?? null,
    status: isOneOf<LeadStatus>(filters.status, ['OPEN', 'WON', 'LOST'])
      ? filters.status
      : null,
    priority: isOneOf<Priority>(filters.priority, PRIORITY_ORDER)
      ? filters.priority
      : null,
  }
}

/** The half-open instant range a calendar-day range covers, in local time. */
export function instants(range: ResolvedRange) {
  return {
    gte: localDayStart(range.from),
    lt: localDayStart(addDays(range.to, 1)),
  }
}

/**
 * The lead predicates that are not about dates.
 *
 * Split out from the date because the three questions a report asks of a lead
 * are dated differently and filtered identically: leads *created* in the period,
 * leads *closed* in the period, and the pipeline as it stands *now*. A single
 * combined builder would have forced every caller that wanted the third to
 * unpick the first.
 *
 * `AND` rather than a spread for the visibility disjunction: a caller adding its
 * own `OR` — the aging report does — would otherwise replace the scope's, and
 * the failure mode of that mistake is a BDE seeing the whole company's pipeline.
 */
export function leadFacts(scope: AnalyticsScope) {
  return {
    isDeleted: false,
    ...(scope.verticalId ? { verticalId: scope.verticalId } : {}),
    ...(scope.sourceId ? { sourceId: scope.sourceId } : {}),
    ...(scope.bde ? { generatedById: scope.bde } : {}),
    ...(scope.bdm ? { assignedToId: scope.bdm } : {}),
    ...(scope.teamId ? { teamId: scope.teamId } : {}),
    ...(scope.status ? { status: scope.status } : {}),
    ...(scope.priority ? { priority: scope.priority } : {}),
    AND: scope.visible
      ? [
          {
            OR: [
              { generatedById: { in: scope.visible } },
              { assignedToId: { in: scope.visible } },
            ],
          },
        ]
      : [],
  }
}

/**
 * Leads created in the period — the cohort every count KPI is drawn from.
 *
 * The dashboard's Total / Open / Won / Lost row uses one cohort on purpose, so
 * the four numbers add up and the conversion has a denominator somebody can
 * point at. Dating Won by *when it was won* instead would make a perfectly
 * reasonable-looking row where Won + Lost + Open exceeds Total, and no way to
 * see why. Outcomes dated by when they happened are a different question, and
 * the Won/Lost report is where it is asked — that report says so at the top.
 */
export function leadsCreatedWhere(scope: AnalyticsScope) {
  return { ...leadFacts(scope), createdAt: instants(scope.range) }
}

/**
 * Leads closed in the period — outcomes as a flow rather than as a cohort.
 *
 * `closedAt` is written by the stage engine when a lead reaches a winning or
 * losing stage, so this is "deals decided in August" regardless of when they
 * were created. Won Revenue is dated this way too, because money is booked when
 * the deal closes and not when the enquiry arrived.
 */
export function leadsClosedWhere(scope: AnalyticsScope) {
  return {
    ...leadFacts(scope),
    closedAt: instants(scope.range),
    // The scope's own status filter wins if one was chosen — a report filtered to
    // Lost should show lost deals, not both. `OPEN` is the exception: combined
    // with `closedAt` it describes a lead that is closed and open at once, so
    // every query built from it would return nothing and the screen would report
    // "no deals decided" when the truth is "that filter does not apply here".
    // The status is spread last either way, because `leadFacts` already carries
    // one and the later key has to be the one that survives.
    status:
      scope.status && scope.status !== 'OPEN'
        ? scope.status
        : ({ in: ['WON', 'LOST'] } as { in: LeadStatus[] }),
  }
}

/**
 * The open pipeline as it stands, ignoring the date range.
 *
 * Pipeline Value is a stock, not a flow: "what is in play right now" does not
 * become a different number because somebody narrowed the report to last month.
 * Every screen showing it says as much, because a date-range filter that
 * visibly does nothing to one card is otherwise read as a bug.
 */
export function openPipelineWhere(scope: AnalyticsScope) {
  return { ...leadFacts(scope), status: 'OPEN' as LeadStatus }
}

/**
 * `/leads` with this filter set applied — the last link in the drill-down chain.
 *
 * The keys match because they were chosen to match; see the note at the top.
 * `dated` exists because not every number on a report is a creation cohort: the
 * Won/Lost report counts deals closed in the period, and handing its `from`/`to`
 * to a lead list that filters on `createdAt` would produce a list that does not
 * contain the rows the number was made of. Where the dates cannot carry over
 * honestly, they are dropped and the link says "all dates".
 */
export function leadListHref(
  scope: AnalyticsScope,
  extra?: Record<string, string | undefined>,
  dated = true,
): string {
  const query = analyticsQuery(
    {
      ...scope.filters,
      ...(dated
        ? { from: scope.range.fromKey, to: scope.range.toKey }
        : { from: undefined, to: undefined }),
    },
    extra,
  )

  return query ? `/leads?${query}` : '/leads'
}

/** The common stages in funnel order, for the pipeline overview. */
export const PIPELINE_STAGES: CommonStage[] = COMMON_STAGE_ORDER

/**
 * The narrower `PeopleScope` the prospecting and staffing metrics take.
 *
 * Those modules predate this one and are shared with the counter summary, so
 * rather than widening them, an analytics scope converts down. The person filter
 * maps to `bde`: everything a `PeopleScope` is used for above the line — counter
 * totals, the bridge % — is attributed to whoever *did* the prospecting, and
 * "assigned to" has no meaning up there. A report filtered by BDM therefore
 * shows that BDM's leads against the *whole scope's* counters, which is the only
 * honest pairing; the BDM report says so where it matters.
 */
export function peopleScopeOf(scope: AnalyticsScope): PeopleScope {
  return {
    visible: scope.visible,
    only: scope.bde,
    teamId: scope.teamId,
  }
}
