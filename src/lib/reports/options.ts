import 'server-only'

import { prisma } from '@/lib/db'
import { loggablePeople } from '@/lib/prospecting/people'
import type { CurrentUser } from '@/lib/auth/session'

/**
 * The dropdown contents for the shared filter bar.
 *
 * One loader for every analytics screen, so the dashboard and the nine reports
 * offer the same choices — and so that the people list is the *scoped* one from
 * `loggablePeople` rather than every user in the company. A BDE offered their
 * manager's name in a filter they cannot act on is a screen promising something
 * `resolveAnalytics` will then quietly refuse.
 */

export type FilterOptions = {
  verticals: Array<{ id: string; name: string; code: string }>
  sources: Array<{ id: string; name: string; verticalId: string | null }>
  people: Array<{ id: string; name: string }>
  teams: Array<{ id: string; name: string }>
}

/**
 * `restrictPeople` narrows the two person pickers to a given set of ids.
 *
 * The dashboard passes its own scope, which for a BDM is just themselves: the
 * page counts only their leads, so offering to filter by a colleague would be a
 * control whose every setting returns nothing. `null` means no restriction,
 * matching what `visibleUserIds` means by it, so an Admin's scope can be handed
 * straight through.
 */
export async function filterOptions(
  user: CurrentUser,
  restrictPeople: string[] | null = null,
): Promise<FilterOptions> {
  const [verticals, sources, people, teams] = await Promise.all([
    prisma.salesVertical.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.leadSource.findMany({
      where: { isActive: true },
      select: { id: true, name: true, verticalId: true },
      orderBy: { name: 'asc' },
    }),
    loggablePeople(user),
    prisma.team.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  return {
    verticals,
    sources,
    people: people
      .filter((person) => !restrictPeople || restrictPeople.includes(person.id))
      .map((person) => ({ id: person.id, name: person.name })),
    teams,
  }
}

/**
 * Every active vertical with the master data the analytics screens read off it:
 * its stage list, its metrics and its module switches.
 *
 * Loaded whole rather than per vertical because the dashboard and three of the
 * reports walk all eight at once, and eight round trips for a table of eight
 * rows is the shape of query the plan asked Phase 6 to stop repeating.
 */
export async function verticalsWithStages() {
  return prisma.salesVertical.findMany({
    where: { isActive: true },
    select: {
      id: true,
      code: true,
      name: true,
      usesRequirements: true,
      usesDemos: true,
      usesQuotations: true,
      usesInvoicing: true,
      metrics: {
        where: { isActive: true },
        select: { id: true, key: true, label: true, isLeadTrigger: true },
        orderBy: { sortOrder: 'asc' },
      },
      stages: {
        where: { isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
          commonStage: true,
          isWon: true,
          isLost: true,
          agingThresholdDays: true,
          sortOrder: true,
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
    orderBy: { sortOrder: 'asc' },
  })
}

export type VerticalWithStages = Awaited<
  ReturnType<typeof verticalsWithStages>
>[number]

/**
 * The counter a vertical's "input" column reads, and whether anybody said so.
 *
 * `isLeadTrigger` is the checkbox that answers open question Q1 — the last count
 * before a Lead exists. `buildFunnel` falls back to the vertical's final metric
 * when the flag is unset, so that a newly added vertical draws a funnel before an
 * administrator has been through Master Data, and this keeps the same rule rather
 * than inventing a second one.
 *
 * What it adds is `configured`. Phase 3 learned this the hard way on the funnel
 * page: a fallback whose number is honest but whose *label* implies a setting
 * that does not exist is a number nobody can check. So the screens append a note
 * to the metric name when the flag is missing, and the fix — one checkbox — is
 * named where the reader is looking.
 */
export function leadTriggerMetric<
  T extends { id: string; label: string; isLeadTrigger: boolean },
>(metrics: T[]): { metric: T | null; configured: boolean } {
  const flagged = metrics.find((metric) => metric.isLeadTrigger)
  if (flagged) return { metric: flagged, configured: true }

  return { metric: metrics.at(-1) ?? null, configured: false }
}

/** The metric's name, marked when it is a fallback rather than a setting. */
export function leadTriggerLabel(trigger: {
  metric: { label: string } | null
  configured: boolean
}): string {
  if (!trigger.metric) return 'No counters by design'
  return trigger.configured
    ? trigger.metric.label
    : `${trigger.metric.label} (no lead-trigger set)`
}
