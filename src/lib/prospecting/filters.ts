import 'server-only'

import { visibleUserIds } from '@/lib/visibility'
import { parseDateKey, startOfWeek, addDays, dateKey } from '@/lib/prospecting/dates'
import type { CurrentUser } from '@/lib/auth/session'

/**
 * The filter bar shared by the counter summary and the vertical funnel.
 *
 * Same idea as `src/app/(app)/leads/filters.ts`: the state lives in the URL, so
 * a funnel someone is looking at can be pasted into a message and open the same
 * numbers for the person reading it (README §37).
 *
 * The two screens use one parser because they answer halves of the same
 * question — the counters above the line and the stages below it — and a
 * summary filtered to August that linked to a funnel filtered to September
 * would be worse than having no link at all.
 */

export const REPORT_FILTER_KEYS = ['from', 'to', 'vertical', 'user', 'team'] as const

export type ReportFilters = Partial<
  Record<(typeof REPORT_FILTER_KEYS)[number], string>
>

export function pickReportFilters(
  params: Record<string, string | string[] | undefined>,
): ReportFilters {
  const filters: ReportFilters = {}

  for (const key of REPORT_FILTER_KEYS) {
    const value = params[key]
    const single = Array.isArray(value) ? value[0] : value
    if (typeof single === 'string' && single.trim() !== '') {
      filters[key] = single.trim()
    }
  }

  return filters
}

export function reportFilterQuery(filters: ReportFilters): string {
  const params = new URLSearchParams()
  for (const key of REPORT_FILTER_KEYS) {
    const value = filters[key]
    if (value) params.set(key, value)
  }
  return params.toString()
}

/**
 * The default period: the last four completed weeks plus the current one.
 *
 * A blank date range would mean "since the beginning", which reads as a
 * plausible number and is almost never the question being asked — a conversion
 * rate averaged over all history hides the month that went wrong. Defaulting to
 * a recent window makes the screen useful before anyone touches a filter, and
 * the range is written back into the form so it is visible rather than implied.
 */
export function defaultRange(now: Date = new Date()): { from: string; to: string } {
  const today = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  )
  const monday = startOfWeek(today)

  return { from: dateKey(addDays(monday, -28)), to: dateKey(today) }
}

export type ResolvedRange = { from: Date; to: Date; fromKey: string; toKey: string }

/**
 * Turn the two date inputs into a UTC day range, falling back to the default
 * window and swapping the ends if they arrive the wrong way round. Swapping
 * rather than erroring: a reversed range is a typo, and an empty report is a
 * poor way to report a typo.
 */
export function resolveRange(filters: ReportFilters, now: Date = new Date()): ResolvedRange {
  const fallback = defaultRange(now)
  let from = (filters.from && parseDateKey(filters.from)) || parseDateKey(fallback.from)!
  let to = (filters.to && parseDateKey(filters.to)) || parseDateKey(fallback.to)!

  if (from > to) [from, to] = [to, from]

  return { from, to, fromKey: dateKey(from), toKey: dateKey(to) }
}

/**
 * Who the numbers may include.
 *
 * `visible` is the data scope (decision D7) — null means no restriction. `only`
 * is the explicit person filter from the form, which must still be inside the
 * scope, otherwise picking a name from the dropdown would be a way to read
 * another team's figures.
 */
export type PeopleScope = {
  visible: string[] | null
  only: string | null
  teamId: string | null
}

export async function resolvePeople(
  user: CurrentUser,
  filters: ReportFilters,
): Promise<PeopleScope> {
  const visible = await visibleUserIds(user)
  const only =
    filters.user && (visible === null || visible.includes(filters.user))
      ? filters.user
      : null

  return { visible, only, teamId: filters.team ?? null }
}

/** `where` for `ProspectingActivity`, scope and filters folded in. */
export function counterWhere(
  range: ResolvedRange,
  people: PeopleScope,
  verticalId?: string | null,
) {
  return {
    activityDate: { gte: range.from, lte: range.to },
    ...(verticalId ? { verticalId } : {}),
    ...(people.only
      ? { userId: people.only }
      : people.visible
        ? { userId: { in: people.visible } }
        : {}),
    ...(people.teamId ? { user: { teamId: people.teamId } } : {}),
  }
}

/** Midnight *local* on the calendar day a UTC-midnight instant names. */
export function localDayStart(utcDay: Date): Date {
  return new Date(
    utcDay.getUTCFullYear(),
    utcDay.getUTCMonth(),
    utcDay.getUTCDate(),
  )
}

/**
 * `where` for leads counted against the same period and people.
 *
 * The person filter reads `generatedById`, not `assignedToId`: the bridge %
 * asks "how many of *this BDE's* pitches turned into a response", so the lead
 * has to be attributed to whoever did the prospecting. Assignment happens
 * afterwards and to someone else — counting it here would credit the BDM's
 * conversion to the BDE's outreach.
 *
 * The visibility scope stays a disjunction over both roles, because that is who
 * may *see* the lead, which is a different question from whose number it is.
 */
export function leadWhereForPeriod(
  range: ResolvedRange,
  people: PeopleScope,
  verticalId?: string | null,
) {
  // `activityDate` is a calendar day and `Lead.createdAt` is a real instant, so
  // the same range has to be expressed twice. The counter half is UTC midnight
  // (see src/lib/prospecting/dates.ts); the lead half has to be *local* midnight
  // of the same calendar days, or east of UTC the first five and a half hours of
  // each day would fall outside a range that plainly includes that date. The
  // upper bound is the start of the following day, exclusive, so the closing
  // day is included whole.
  const from = localDayStart(range.from)
  const to = localDayStart(addDays(range.to, 1))

  return {
    isDeleted: false,
    createdAt: { gte: from, lt: to },
    ...(verticalId ? { verticalId } : {}),
    ...(people.only ? { generatedById: people.only } : {}),
    ...(people.teamId ? { teamId: people.teamId } : {}),
    ...(people.visible
      ? {
          OR: [
            { generatedById: { in: people.visible } },
            { assignedToId: { in: people.visible } },
          ],
        }
      : {}),
  }
}
