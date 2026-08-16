import 'server-only'

import { normalisePhone } from '@/lib/dedupe'

/**
 * The candidate master's filters — searchable by skill, experience and
 * location, which is what docs/03 §1 asks of this screen and what a recruiter
 * actually types when a requirement lands.
 *
 * No visibility scope, unlike every other list in this application. Decision D9
 * makes the candidate master shared so that the same person submitted to three
 * clients stays one candidate; a master where a recruiter cannot see the
 * profile a colleague sourced produces exactly the duplicate rows it exists to
 * prevent. A candidate row carries no client's information — that lives on the
 * submission, which is scoped through its requirement like everything else.
 * Reaching this list at all requires `staffing.candidate.manage`.
 */

export const CANDIDATE_FILTER_KEYS = [
  'q',
  'skill',
  'location',
  'minExp',
  'maxExp',
  'notice',
  'source',
  'status',
] as const

export type CandidateFilters = Partial<
  Record<(typeof CANDIDATE_FILTER_KEYS)[number], string>
>

export function pickCandidateFilters(
  params: Record<string, string | string[] | undefined>,
): CandidateFilters {
  const filters: CandidateFilters = {}

  for (const key of CANDIDATE_FILTER_KEYS) {
    const value = params[key]
    const single = Array.isArray(value) ? value[0] : value
    if (typeof single === 'string' && single.trim() !== '') {
      filters[key] = single.trim()
    }
  }

  return filters
}

export function candidateFilterQuery(filters: CandidateFilters): string {
  const params = new URLSearchParams()
  for (const key of CANDIDATE_FILTER_KEYS) {
    const value = filters[key]
    if (value) params.set(key, value)
  }
  return params.toString()
}

/** A years-of-experience input, or null if it is not a number. */
function years(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function candidateWhere(filters: CandidateFilters) {
  const insensitive = (value: string) => ({
    contains: value,
    mode: 'insensitive' as const,
  })

  const minExp = years(filters.minExp)
  const maxExp = years(filters.maxExp)

  // The two bounds read as "someone in this band", so a minimum filters the
  // candidate's *total* experience upwards and a maximum downwards. Both
  // against one column, which is why they combine into a single range rather
  // than two independent conditions.
  const experience =
    minExp !== null || maxExp !== null
      ? {
          ...(minExp !== null ? { gte: minExp } : {}),
          ...(maxExp !== null ? { lte: maxExp } : {}),
        }
      : undefined

  const notice = years(filters.notice)

  // A typed number is reduced to the same normalised form the row stores, the
  // same fix `ClientContact` got in Phase 2 — comparing against the as-typed
  // `phone` column matched nothing for anyone who had punctuated it.
  const phone = filters.q ? normalisePhone(filters.q) : null

  return {
    isDeleted: false,

    AND: [
      ...(filters.q
        ? [
            {
              OR: [
                { fullName: insensitive(filters.q) },
                { candidateCode: insensitive(filters.q) },
                { email: insensitive(filters.q) },
                { currentEmployer: insensitive(filters.q) },
                ...(phone ? [{ phoneNormalised: phone }] : []),
              ],
            },
          ]
        : []),
      // Skills are one free-text column, so a multi-skill search is an AND of
      // `contains` — typing "Java, Kafka" should narrow to people with both,
      // not widen to everyone with either. Splitting on commas is what makes
      // the field behave the way its placeholder promises.
      ...(filters.skill
        ? filters.skill
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
            .map((skill) => ({ primarySkills: insensitive(skill) }))
        : []),
    ],

    ...(filters.location
      ? {
          OR: [
            { currentLocation: insensitive(filters.location) },
            { preferredLocation: insensitive(filters.location) },
          ],
        }
      : {}),
    ...(experience ? { totalExperienceYears: experience } : {}),
    ...(notice !== null ? { noticePeriodDays: { lte: notice } } : {}),
    ...(filters.source ? { sourceChannel: filters.source } : {}),
    // Retired profiles are hidden by default: someone who has left the market
    // should not keep appearing in every skill search. `all` brings them back.
    ...(filters.status === 'all'
      ? {}
      : filters.status === 'inactive'
        ? { isActive: false }
        : { isActive: true }),
  }
}
