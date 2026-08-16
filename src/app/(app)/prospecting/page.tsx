import { prisma } from '@/lib/db'
import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { loggablePeople } from '@/lib/prospecting/people'
import {
  addDays,
  dateKey,
  formatWeekRange,
  parseDateKey,
  shortDayLabel,
  startOfWeek,
  todayKey,
  weekDays,
} from '@/lib/prospecting/dates'
import { AccessDenied } from '@/components/access-denied'
import { ButtonLink } from '@/components/ui/button'
import { Select } from '@/components/ui/field'
import { Card, EmptyState, PageHeader } from '@/components/ui/page'
import { WeekGrid, type GridDay } from './week-grid'

export const metadata = { title: 'Prospecting · Sales CRM' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function one(value: string | string[] | undefined): string | undefined {
  const single = Array.isArray(value) ? value[0] : value
  return typeof single === 'string' && single.trim() !== '' ? single.trim() : undefined
}

/**
 * Daily counter entry (decision D1, docs/03 §1).
 *
 * Everything above the line lives here: pitches, calls, emails and outreach,
 * counted per person per day with no client record and no lead record behind
 * them. The line itself is what makes this screen cheap enough to use every
 * day — a BDE logging forty pitches types one number, not forty records.
 *
 * The vertical, the week and the person are all in the URL, so a manager can
 * send "fill this in" as a link that opens on the right week.
 */
export default async function ProspectingPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.PROSPECTING_LOG)
  if (!viewer) return <AccessDenied what="prospecting counters" />

  const params = await searchParams

  // Only verticals that actually count something. Product Sales and Other
  // Sources have no counters by design (docs/02 §2) — the inquiry itself is the
  // lead — so offering them here would be offering an empty grid.
  const verticals = await prisma.salesVertical.findMany({
    where: { isActive: true, metrics: { some: { isActive: true } } },
    select: {
      id: true,
      name: true,
      metrics: {
        where: { isActive: true },
        select: { id: true, label: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
    orderBy: { sortOrder: 'asc' },
  })

  if (verticals.length === 0) {
    return (
      <>
        <PageHeader title="Prospecting" />
        <EmptyState>
          No vertical has any counters configured. An administrator can add them
          under Master Data → Verticals.
        </EmptyState>
      </>
    )
  }

  const requestedVertical = one(params.vertical)
  const vertical =
    verticals.find((row) => row.id === requestedVertical) ?? verticals[0]

  const today = todayKey()
  const requestedWeek = one(params.week)
  const monday = startOfWeek(
    (requestedWeek ? parseDateKey(requestedWeek) : null) ?? parseDateKey(today)!,
  )
  const days = weekDays(monday)

  const people = await loggablePeople(viewer)
  const requestedUser = one(params.user)
  const ownerId =
    requestedUser && people.some((person) => person.id === requestedUser)
      ? requestedUser
      : viewer.id

  const existing = await prisma.prospectingActivity.findMany({
    where: {
      userId: ownerId,
      verticalId: vertical.id,
      activityDate: { gte: monday, lte: days[6] },
    },
    select: { metricId: true, activityDate: true, count: true },
  })

  const initial: Record<string, number> = {}
  for (const row of existing) {
    initial[`${row.metricId}:${dateKey(row.activityDate)}`] = row.count
  }

  const gridDays: GridDay[] = days.map((day) => {
    const key = dateKey(day)
    const { weekday, day: dayNumber } = shortDayLabel(day)
    return {
      key,
      weekday,
      day: dayNumber,
      isFuture: key > today,
      isToday: key === today,
    }
  })

  const link = (overrides: Record<string, string>) => {
    const next = new URLSearchParams({
      vertical: vertical.id,
      week: dateKey(monday),
      ...(ownerId === viewer.id ? {} : { user: ownerId }),
      ...overrides,
    })
    return `/prospecting?${next.toString()}`
  }

  const thisMonday = dateKey(startOfWeek(parseDateKey(today)!))

  return (
    <>
      <PageHeader
        title="Prospecting counters"
        description="Everything above the line — pitches, calls, emails and outreach — counted per day. A lead record only starts once a prospect responds."
        actions={
          <ButtonLink href="/prospecting/summary" variant="secondary">
            Summary
          </ButtonLink>
        }
      />

      {/* A plain GET form, so the three pickers are one submit and the result is
          a URL somebody can send. The week arrows are links for the same
          reason. */}
      <form
        method="get"
        className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3"
      >
        <div className="min-w-48">
          <label
            htmlFor="vertical"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Vertical
          </label>
          <Select id="vertical" name="vertical" defaultValue={vertical.id}>
            {verticals.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </Select>
        </div>

        {people.length > 1 ? (
          <div className="min-w-48">
            <label
              htmlFor="user"
              className="mb-1 block text-xs font-medium text-slate-600"
            >
              Logging for
            </label>
            <Select id="user" name="user" defaultValue={ownerId}>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                  {person.id === viewer.id ? ' (you)' : ` · ${person.roleLabel}`}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        <div>
          <label
            htmlFor="week"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Week of
          </label>
          <input
            id="week"
            name="week"
            type="date"
            defaultValue={dateKey(monday)}
            className="h-9 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900 shadow-xs"
          />
        </div>

        <button
          type="submit"
          className="h-9 rounded-md border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Go
        </button>
      </form>

      <Card
        title={formatWeekRange(monday)}
        description={
          ownerId === viewer.id
            ? `${vertical.name} — your counters for this week.`
            : `${vertical.name} — ${
                people.find((person) => person.id === ownerId)?.name ?? 'this user'
              }’s counters for this week.`
        }
        actions={
          <div className="flex gap-1">
            <ButtonLink
              href={link({ week: dateKey(addDays(monday, -7)) })}
              variant="ghost"
              size="sm"
            >
              ← Previous
            </ButtonLink>
            {dateKey(monday) === thisMonday ? null : (
              <ButtonLink href={link({ week: thisMonday })} variant="ghost" size="sm">
                This week
              </ButtonLink>
            )}
            <ButtonLink
              href={link({ week: dateKey(addDays(monday, 7)) })}
              variant="ghost"
              size="sm"
            >
              Next →
            </ButtonLink>
          </div>
        }
      >
        <WeekGrid
          // Remount when the grid is pointed at different data. Without this the
          // inputs keep the previous week's state, which would then be saved
          // against the new week on the next submit.
          key={`${vertical.id}:${dateKey(monday)}:${ownerId}`}
          verticalId={vertical.id}
          week={dateKey(monday)}
          userId={ownerId}
          metrics={vertical.metrics}
          days={gridDays}
          initial={initial}
        />
      </Card>
    </>
  )
}
