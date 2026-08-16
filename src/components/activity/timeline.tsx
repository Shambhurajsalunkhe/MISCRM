import { ACTIVITY_TYPE_LABELS } from '@/lib/activity-types'
import { formatDateTime, formatDate } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/page'
import { RowAction } from '@/components/row-action'
import { deleteActivityAction } from '@/server/activities'
import type { ActivityType } from '@/generated/prisma/enums'

export type TimelineEntry = {
  id: string
  type: ActivityType
  subject: string
  notes: string | null
  outcome: string | null
  activityDate: Date
  followUpDate: Date | null
  user: { id: string; name: string }
}

/**
 * The chronological record on a lead or client (README §23).
 *
 * Newest first. A salesperson opening a lead wants to know what happened last,
 * not what happened first — the whole point of the tab is "where did we leave
 * this".
 */
export function Timeline({
  entries,
  canManage,
}: {
  entries: TimelineEntry[]
  canManage: boolean
}) {
  if (entries.length === 0) {
    return <EmptyState>Nothing logged yet.</EmptyState>
  }

  // Compared against the start of today, not the current instant. Follow-up
  // dates are date-only, so they land at midnight — measuring from `now` marked
  // everything due today as already overdue from 00:01 onwards, which is both
  // wrong and the opposite of reassuring first thing in the morning.
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  return (
    <ol className="space-y-3">
      {entries.map((entry) => {
        const overdue =
          entry.followUpDate && entry.followUpDate < startOfToday

        return (
          <li
            key={entry.id}
            className="rounded-lg border border-slate-200 bg-white p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{ACTIVITY_TYPE_LABELS[entry.type]}</Badge>
                  <span className="font-medium text-slate-900">
                    {entry.subject}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {formatDateTime(entry.activityDate)} · {entry.user.name}
                </p>
              </div>

              {canManage ? (
                <RowAction
                  action={deleteActivityAction}
                  id={entry.id}
                  label="Delete"
                  confirmMessage={`Delete “${entry.subject}”? The audit trail keeps a record of the deletion.`}
                />
              ) : null}
            </div>

            {entry.notes ? (
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                {entry.notes}
              </p>
            ) : null}

            {entry.outcome ? (
              <p className="mt-2 text-sm text-slate-600">
                <span className="font-medium text-slate-700">Outcome:</span>{' '}
                {entry.outcome}
              </p>
            ) : null}

            {entry.followUpDate ? (
              <p
                className={`mt-2 text-xs ${overdue ? 'font-medium text-red-600' : 'text-slate-500'}`}
              >
                Follow up {overdue ? 'was due' : 'on'}{' '}
                {formatDate(entry.followUpDate)}
              </p>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
