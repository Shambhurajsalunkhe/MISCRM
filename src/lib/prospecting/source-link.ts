import 'server-only'

import { prisma } from '@/lib/db'
import { visibleUserIds } from '@/lib/visibility'
import { addDays, formatCounterDate } from '@/lib/prospecting/dates'
import type { CurrentUser } from '@/lib/auth/session'

/**
 * Linking a lead back to the counter batch it came from
 * (`Lead.sourceActivityId`, decision D1).
 *
 * The bridge % works without this — it divides leads created by counters logged
 * and needs no join. What it cannot do without this is answer "which pitches
 * actually turned into something", which is the question a BDE asks of their
 * own week and the one docs/02 §1 means by *auditable rather than purely
 * statistical*. It stays optional: a lead that arrives without anyone
 * remembering which day's outreach produced it is still a lead.
 */

/** How far back the picker looks. A response to a pitch sent last quarter is
 * possible; offering ninety options to cover it is not worth the scrolling. */
const LOOKBACK_DAYS = 45

/** How many batches the picker offers before it stops being a picker. */
const LIMIT = 60

export type SourceActivityOption = { id: string; label: string }

export async function recentCounterBatches(
  user: CurrentUser,
  verticalId: string,
): Promise<SourceActivityOption[]> {
  const ids = await visibleUserIds(user)

  // UTC midnight, like every other bound on `activityDate` — see
  // src/lib/prospecting/dates.ts for why a local-midnight instant would land on
  // the wrong calendar day here.
  const now = new Date()
  const cutoff = addDays(
    new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())),
    -LOOKBACK_DAYS,
  )

  const rows = await prisma.prospectingActivity.findMany({
    where: {
      verticalId,
      count: { gt: 0 },
      activityDate: { gte: cutoff },
      ...(ids ? { userId: { in: ids } } : {}),
    },
    select: {
      id: true,
      activityDate: true,
      count: true,
      userId: true,
      metric: { select: { label: true } },
      user: { select: { name: true } },
    },
    orderBy: [{ activityDate: 'desc' }, { metricId: 'asc' }],
    take: LIMIT,
  })

  return rows.map((row) => ({
    id: row.id,
    label: `${formatCounterDate(row.activityDate)} · ${row.metric.label} · ${row.count}${
      row.userId === user.id ? '' : ` — ${row.user.name}`
    }`,
  }))
}

/**
 * Confirm a submitted batch id is one this user could have chosen.
 *
 * Re-checked on save rather than trusted from the form: the id names a row in
 * someone's counter history, and accepting an arbitrary one would let a lead be
 * attributed to another team's outreach — which is a quiet way to move credit
 * on the BDE report.
 */
export async function isValidSourceActivity(
  user: CurrentUser,
  activityId: string,
  verticalId: string,
): Promise<boolean> {
  const ids = await visibleUserIds(user)

  const row = await prisma.prospectingActivity.findFirst({
    where: {
      id: activityId,
      verticalId,
      ...(ids ? { userId: { in: ids } } : {}),
    },
    select: { id: true },
  })

  return row !== null
}
