import 'server-only'

import { requirementVisibilityFilter } from '@/lib/visibility'
import { PRIORITY_ORDER } from '@/lib/leads/display'
import { REQUIREMENT_STATUS_ORDER } from '@/lib/staffing/display'
import type { CurrentUser } from '@/lib/auth/session'
import type { Priority, RequirementStatus } from '@/generated/prisma/enums'

/**
 * The requirement list's filters — the same URL-as-state approach as
 * `src/app/(app)/leads/filters.ts`, for the same reasons (README §30, §37).
 *
 * One filter behaves differently from anything on the lead list, and it is the
 * important one: **`status` defaults to the live requirements**. A recruiter
 * opening this screen is asking "what do I have to fill", not "what has ever
 * existed", and a list that opens on every requirement ever raised buries the
 * dozen that matter under last year's. `status=all` is the explicit way back to
 * everything, and the empty state says so.
 */

export const REQUIREMENT_FILTER_KEYS = [
  'q',
  'status',
  'stage',
  'client',
  'owner',
  'type',
  'priority',
  'from',
  'to',
  'aging',
] as const

export type RequirementFilters = Partial<
  Record<(typeof REQUIREMENT_FILTER_KEYS)[number], string>
>

/** The statuses the default view shows: everything still being worked. */
const LIVE_STATUSES: RequirementStatus[] = [
  'OPEN',
  'ON_HOLD',
  'PARTIALLY_FILLED',
]

export function pickRequirementFilters(
  params: Record<string, string | string[] | undefined>,
): RequirementFilters {
  const filters: RequirementFilters = {}

  for (const key of REQUIREMENT_FILTER_KEYS) {
    const value = params[key]
    const single = Array.isArray(value) ? value[0] : value
    if (typeof single === 'string' && single.trim() !== '') {
      filters[key] = single.trim()
    }
  }

  return filters
}

export function requirementFilterQuery(filters: RequirementFilters): string {
  const params = new URLSearchParams()
  for (const key of REQUIREMENT_FILTER_KEYS) {
    const value = filters[key]
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
 * Split a `<input type="date">` value into its calendar parts.
 *
 * Same rule and same reason as the lead list's copy: a bare `yyyy-MM-dd` handed
 * to `new Date()` is parsed as UTC midnight, so west of UTC a "from 16 Aug"
 * filter would quietly include the 15th.
 */
function dayParts(value: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null

  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(year, month - 1, day)

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null
  }

  return [year, month, day]
}

function startOfDay(value: string): Date | null {
  const parts = dayParts(value)
  return parts ? new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0) : null
}

function endOfDay(value: string): Date | null {
  const parts = dayParts(value)
  return parts
    ? new Date(parts[0], parts[1] - 1, parts[2], 23, 59, 59, 999)
    : null
}

/**
 * Build the Prisma `where`, with the user's data scope already folded in.
 *
 * Visibility is applied here rather than by the caller for the reason the lead
 * list learned the hard way: two disjunctions spread into one object silently
 * overwrite each other, and the one that disappears is the scope.
 */
export async function requirementWhere(
  user: CurrentUser,
  filters: RequirementFilters,
  now: Date = new Date(),
) {
  const from = filters.from ? startOfDay(filters.from) : null
  const to = filters.to ? endOfDay(filters.to) : null

  const createdAt =
    from || to
      ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }
      : undefined

  // "Ageing" is time in the current stage against that stage's own threshold,
  // which is per-stage master data rather than one number — so the filter asks
  // the coarser question the list can answer in SQL: nothing has moved in a
  // fortnight. The requirement detail shows the real per-stage threshold.
  const stale = new Date(now.getTime() - 14 * 86_400_000)

  const status = isOneOf<RequirementStatus>(
    filters.status,
    REQUIREMENT_STATUS_ORDER,
  )
    ? { status: filters.status }
    : // `all` is the only way to opt out of the default. An unrecognised value
      // falls back to the default rather than to everything, so a stale
      // bookmark cannot silently widen what someone is looking at.
      filters.status === 'all'
      ? {}
      : { status: { in: LIVE_STATUSES } }

  return {
    isDeleted: false,

    AND: [
      await requirementVisibilityFilter(user),
      ...(filters.q
        ? [
            {
              OR: [
                {
                  requirementCode: {
                    contains: filters.q,
                    mode: 'insensitive' as const,
                  },
                },
                { position: { contains: filters.q, mode: 'insensitive' as const } },
                { skills: { contains: filters.q, mode: 'insensitive' as const } },
                {
                  client: {
                    clientName: {
                      contains: filters.q,
                      mode: 'insensitive' as const,
                    },
                  },
                },
              ],
            },
          ]
        : []),
      // Inside the `AND` rather than spread alongside `status`, so an explicit
      // status filter and this one are combined rather than one silently
      // replacing the other. Asking for lost *and* stale then returns nothing,
      // which is the truthful answer to a contradictory question.
      ...(filters.aging === 'stale'
        ? [{ stageChangedAt: { lt: stale }, status: { in: LIVE_STATUSES } }]
        : []),
    ],

    ...status,
    ...(filters.stage ? { currentStageId: filters.stage } : {}),
    ...(filters.client ? { clientId: filters.client } : {}),
    ...(filters.owner ? { assignedToId: filters.owner } : {}),
    ...(filters.type ? { requirementTypeId: filters.type } : {}),
    ...(isOneOf<Priority>(filters.priority, PRIORITY_ORDER)
      ? { priority: filters.priority }
      : {}),
    ...(createdAt ? { createdAt } : {}),
  }
}
