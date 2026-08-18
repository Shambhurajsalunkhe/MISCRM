import 'server-only'

import { prisma } from '@/lib/db'
import { leadVisibilityFilter } from '@/lib/visibility'
import { toDateTimeInputValue } from '@/lib/format'
import type { CurrentUser } from '@/lib/auth/session'
import type {
  SchedulableLead,
  UpcomingCallView,
} from '@/components/activity/upcoming-calls'

/** Kept small on purpose: this is a diary, not a report. */
export const UPCOMING_LIMIT = 12

/** How many leads the "schedule a call" picker offers before it is cut. */
const PICKER_LIMIT = 200

/**
 * Everything the timeline panel under the lead list needs, in one pass.
 *
 * The labels are formatted here rather than in the component because the
 * component is a client one: a `Date` formatted in the browser uses the
 * browser's timezone and locale, so the times would shift between the server
 * render and the hydrated one. `en-GB` and the server's zone, like every other
 * date in the app (see `src/lib/format.ts`).
 */
export async function upcomingCalls(viewer: CurrentUser): Promise<{
  calls: UpcomingCallView[]
  schedulable: SchedulableLead[]
  truncated: boolean
}> {
  const visible = await leadVisibilityFilter(viewer)

  const [rows, leads] = await Promise.all([
    prisma.activity.findMany({
      where: {
        // The viewer's own diary, not their data scope. A BDM can see their
        // sub-tree's leads in the list above, but somebody else's arrangements
        // are not theirs to work from — this panel answers "what am I doing
        // next", and a colleague's calls would make it useless for that.
        // Visibility is applied as well, so a plan on a lead that has since
        // moved out of scope drops out rather than leaking a lead code.
        userId: viewer.id,
        isPlanned: true,
        leadId: { not: null },
        lead: { isDeleted: false, ...visible },
      },
      // Soonest first, which puts anything overdue at the very top: a call that
      // was due yesterday and never marked done is the first thing to see, and
      // hiding it would strand the row where nothing lists it.
      orderBy: { activityDate: 'asc' },
      // One more than the cap, so the footer can say the list was cut without a
      // second counting query.
      take: UPCOMING_LIMIT + 1,
      select: {
        id: true,
        type: true,
        subject: true,
        notes: true,
        activityDate: true,
        lead: {
          select: {
            id: true,
            leadCode: true,
            title: true,
            client: { select: { clientName: true } },
          },
        },
      },
    }),
    prisma.lead.findMany({
      where: { isDeleted: false, status: 'OPEN', ...visible },
      orderBy: { createdAt: 'desc' },
      take: PICKER_LIMIT,
      select: {
        id: true,
        leadCode: true,
        title: true,
        client: { select: { clientName: true } },
      },
    }),
  ])

  const now = new Date()

  return {
    truncated: rows.length > UPCOMING_LIMIT,
    calls: rows.slice(0, UPCOMING_LIMIT).flatMap((row) =>
      // `leadId: { not: null }` already guarantees the join; the check is here
      // to satisfy the optional relation type rather than to catch anything.
      row.lead
        ? [
            {
              id: row.id,
              type: row.type,
              subject: row.subject,
              notes: row.notes,
              at: toDateTimeInputValue(row.activityDate),
              dayLabel: row.activityDate.toLocaleDateString('en-GB', {
                weekday: 'short',
                day: '2-digit',
                month: 'short',
              }),
              timeLabel: row.activityDate.toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
              }),
              overdue: row.activityDate < now,
              lead: {
                id: row.lead.id,
                leadCode: row.lead.leadCode,
                title: row.lead.title,
                clientName: row.lead.client.clientName,
              },
            },
          ]
        : [],
    ),
    // Open leads only. Arranging a call on a deal that is already won or lost is
    // not something the picker should make easy; the lead's own timeline is
    // still there for the exception.
    schedulable: leads.map((lead) => ({
      id: lead.id,
      label: `${lead.leadCode} · ${lead.client.clientName} · ${lead.title}`,
    })),
  }
}
