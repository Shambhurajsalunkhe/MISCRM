import { prisma } from '@/lib/db'
import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import {
  counterWhere,
  leadWhereForPeriod,
  pickReportFilters,
  reportFilterQuery,
  resolvePeople,
  resolveRange,
} from '@/lib/prospecting/filters'
import { formatRate, rate } from '@/lib/prospecting/metrics'
import { loggablePeople } from '@/lib/prospecting/people'
import { dateKey, formatCounterDate } from '@/lib/prospecting/dates'
import { AccessDenied } from '@/components/access-denied'
import { ReportFilterBar } from '@/components/report-filters'
import { ButtonLink } from '@/components/ui/button'
import { Card, EmptyState, PageHeader } from '@/components/ui/page'
import { Stat, StatRow } from '@/components/ui/stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'

export const metadata = { title: 'Counter summary · Sales CRM' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const number = (value: number) => value.toLocaleString('en-GB')

/**
 * Counter totals by vertical, person and day, with the bridge conversion %
 * (docs/03 §1, docs/02 §1).
 *
 * The bridge is the one number that spans decision D1's line: leads created in
 * the period ÷ the counter that immediately precedes a lead. It is the reason
 * the counters are worth typing at all — 850 pitches is a workload, and
 * 850 pitches against 145 responses is a conversion rate somebody can manage.
 */
export default async function CounterSummaryPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.PROSPECTING_LOG)
  if (!viewer) return <AccessDenied what="prospecting counters" />

  const filters = pickReportFilters(await searchParams)
  const range = resolveRange(filters)
  const people = await resolvePeople(viewer, filters)
  const verticalId = filters.vertical ?? null

  const activityWhere = counterWhere(range, people, verticalId)
  const leadWhere = leadWhereForPeriod(range, people, verticalId)

  const [metrics, byMetric, byPerson, byDay, leadRows, verticals, teams, staff] =
    await Promise.all([
      prisma.verticalMetric.findMany({
        where: { isActive: true, ...(verticalId ? { verticalId } : {}) },
        select: {
          id: true,
          label: true,
          isLeadTrigger: true,
          sortOrder: true,
          verticalId: true,
          vertical: { select: { id: true, name: true, sortOrder: true } },
        },
        orderBy: [{ vertical: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
      }),
      prisma.prospectingActivity.groupBy({
        by: ['metricId'],
        where: activityWhere,
        _sum: { count: true },
      }),
      prisma.prospectingActivity.groupBy({
        by: ['userId', 'metricId'],
        where: activityWhere,
        _sum: { count: true },
      }),
      prisma.prospectingActivity.groupBy({
        by: ['activityDate'],
        where: activityWhere,
        _sum: { count: true },
        orderBy: { activityDate: 'desc' },
      }),
      // Bucketed in JS rather than in SQL: `createdAt` is a timestamp, and the
      // day it belongs to is the day where the *reader* is, which Postgres
      // cannot know. Only the timestamp is selected, so this stays cheap at the
      // volumes assumed in open question Q5.
      prisma.lead.findMany({
        where: leadWhere,
        select: { createdAt: true, verticalId: true, generatedById: true },
      }),
      prisma.salesVertical.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.team.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      loggablePeople(viewer),
    ])

  const metricById = new Map(metrics.map((metric) => [metric.id, metric]))
  const totalByMetric = new Map(
    byMetric.map((row) => [row.metricId, row._sum.count ?? 0]),
  )

  // --- Leads, bucketed the three ways the tables need ------------------------
  const leadsByVertical = new Map<string, number>()
  const leadsByPerson = new Map<string, number>()
  const leadsByDay = new Map<string, number>()

  for (const lead of leadRows) {
    leadsByVertical.set(
      lead.verticalId,
      (leadsByVertical.get(lead.verticalId) ?? 0) + 1,
    )
    leadsByPerson.set(
      lead.generatedById,
      (leadsByPerson.get(lead.generatedById) ?? 0) + 1,
    )
    // `dateKey`, i.e. the UTC calendar day — the same convention the By-day
    // table's rows are keyed by, since those come from `activityDate` which is
    // a calendar day and nothing else. Bucketing leads by the *local* day
    // instead put a lead created at 02:00 IST under a key no counter row could
    // ever carry, so it silently vanished from the column beside its own day.
    // Joining two dated things means picking one calendar, and the counter's is
    // the one that is genuinely a calendar.
    const day = dateKey(lead.createdAt)
    leadsByDay.set(day, (leadsByDay.get(day) ?? 0) + 1)
  }

  // --- By vertical -----------------------------------------------------------
  const verticalRows = new Map<
    string,
    {
      id: string
      name: string
      metrics: Array<{ label: string; total: number; isLeadTrigger: boolean }>
      triggerLabels: string[]
      triggerTotal: number
      total: number
    }
  >()

  for (const metric of metrics) {
    const total = totalByMetric.get(metric.id) ?? 0
    const row = verticalRows.get(metric.verticalId) ?? {
      id: metric.vertical.id,
      name: metric.vertical.name,
      metrics: [],
      triggerLabels: [],
      triggerTotal: 0,
      total: 0,
    }

    row.metrics.push({
      label: metric.label,
      total,
      isLeadTrigger: metric.isLeadTrigger,
    })
    row.total += total

    // Accumulated, not assigned. Nothing stops an administrator flagging two
    // metrics as the lead trigger, and overwriting made the row's Bridge %
    // divide by the last one alone while the headline Stat divided by their
    // sum — two numbers on one screen disagreeing with no visible cause.
    if (metric.isLeadTrigger) {
      row.triggerLabels.push(metric.label)
      row.triggerTotal += total
    }

    verticalRows.set(metric.verticalId, row)
  }

  // --- By person -------------------------------------------------------------
  const personRows = new Map<
    string,
    { counters: number; triggers: number }
  >()

  for (const row of byPerson) {
    const metric = metricById.get(row.metricId)
    const value = row._sum.count ?? 0
    const current = personRows.get(row.userId) ?? { counters: 0, triggers: 0 }

    current.counters += value
    if (metric?.isLeadTrigger) current.triggers += value

    personRows.set(row.userId, current)
  }

  // Anyone who generated a lead but logged no counters still belongs in the
  // table — a zero-counter row with leads against it is exactly the case a
  // manager wants to see, not one to hide.
  for (const personId of leadsByPerson.keys()) {
    if (!personRows.has(personId)) {
      personRows.set(personId, { counters: 0, triggers: 0 })
    }
  }

  const personNames = new Map(staff.map((person) => [person.id, person.name]))
  const personTable = [...personRows.entries()]
    .map(([id, value]) => ({
      id,
      name: personNames.get(id) ?? 'Former user',
      ...value,
      leads: leadsByPerson.get(id) ?? 0,
    }))
    .sort((a, b) => b.counters - a.counters || a.name.localeCompare(b.name))

  // --- Headline --------------------------------------------------------------
  const totalCounters = [...totalByMetric.values()].reduce((a, b) => a + b, 0)
  const totalTriggers = metrics
    .filter((metric) => metric.isLeadTrigger)
    .reduce((total, metric) => total + (totalByMetric.get(metric.id) ?? 0), 0)
  const totalLeads = leadRows.length
  const daysLogged = byDay.length

  const query = reportFilterQuery(filters)

  return (
    <>
      <PageHeader
        title="Counter summary"
        description="Totals above the line, and the bridge into leads. Every percentage here divides leads created in the period by the counter that precedes them."
        actions={
          <ButtonLink href="/prospecting" variant="secondary">
            Enter counters
          </ButtonLink>
        }
      />

      <ReportFilterBar
        action="/prospecting/summary"
        filters={filters}
        from={range.fromKey}
        to={range.toKey}
        verticals={verticals.map((row) => ({ value: row.id, label: row.name }))}
        people={staff.map((row) => ({ value: row.id, label: row.name }))}
        teams={teams.map((row) => ({ value: row.id, label: row.name }))}
      />

      <p className="text-xs text-slate-500">
        {formatCounterDate(range.from)} to {formatCounterDate(range.to)}
        {filters.from || filters.to ? '' : ' (default — the last five weeks)'}
      </p>

      <StatRow>
        <Stat label="Counters logged" value={number(totalCounters)} hint={`Across ${daysLogged} ${daysLogged === 1 ? 'day' : 'days'}`} />
        <Stat
          label="Leads created"
          value={number(totalLeads)}
          hint="Below the line — one record per opportunity"
          // `people.only`, not `filters.user`: a person filter naming somebody
          // outside the viewer's scope is dropped when the number is computed,
          // so carrying the raw parameter into the link would send them to a
          // list filtered by someone the figure above it did not filter by.
          href={`/leads?${new URLSearchParams({
            ...(filters.vertical ? { vertical: filters.vertical } : {}),
            from: range.fromKey,
            to: range.toKey,
            ...(people.only ? { bde: people.only } : {}),
            ...(filters.team ? { team: filters.team } : {}),
          }).toString()}`}
        />
        <Stat
          label="Bridge conversion"
          value={formatRate(rate(totalLeads, totalTriggers))}
          hint={`${number(totalLeads)} leads ÷ ${number(totalTriggers)} lead-trigger counters`}
        />
        <Stat
          label="Verticals reporting"
          // Verticals that actually logged something, not verticals that could
          // have. The label says "reporting", and counting the ones with a
          // counter list but no counters made a silent week look like a busy
          // one.
          value={number(
            [...verticalRows.values()].filter((row) => row.total > 0).length,
          )}
          hint={`of ${verticalRows.size} that count anything above the line`}
          tone="muted"
        />
      </StatRow>

      <Card
        title="By vertical"
        description="The bridge divides by the metric an administrator flagged as the last counter before a lead exists (open question Q1)."
      >
        {verticalRows.size === 0 ? (
          <EmptyState>
            No counters in this period. Log a week at{' '}
            <a href="/prospecting" className="underline">
              Prospecting
            </a>
            .
          </EmptyState>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Vertical</TH>
                <TH>Counters</TH>
                <TH className="text-right">Total</TH>
                <TH className="text-right">Leads created</TH>
                <TH className="text-right">Bridge %</TH>
              </TR>
            </THead>
            <TBody>
              {[...verticalRows.values()].map((row) => {
                const leads = leadsByVertical.get(row.id) ?? 0
                return (
                  <TR key={row.id}>
                    <TD className="font-medium text-slate-900">
                      <a
                        href={`/reports/funnel?${new URLSearchParams({
                          vertical: row.id,
                          from: range.fromKey,
                          to: range.toKey,
                          ...(people.only ? { user: people.only } : {}),
                          ...(filters.team ? { team: filters.team } : {}),
                        }).toString()}`}
                        className="hover:underline"
                      >
                        {row.name}
                      </a>
                    </TD>
                    <TD>
                      <ul className="space-y-0.5 text-slate-600">
                        {row.metrics.map((metric) => (
                          <li key={metric.label}>
                            {metric.label}
                            <span className="ml-1.5 tabular-nums text-slate-900">
                              {number(metric.total)}
                            </span>
                            {metric.isLeadTrigger ? (
                              <span className="ml-1.5 text-xs text-slate-400">
                                lead trigger
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </TD>
                    <TD className="text-right tabular-nums">{number(row.total)}</TD>
                    <TD className="text-right tabular-nums">{number(leads)}</TD>
                    <TD className="text-right tabular-nums">
                      {formatRate(rate(leads, row.triggerTotal))}
                      {row.triggerLabels.length > 0 ? (
                        <div className="text-xs font-normal text-slate-500">
                          of {row.triggerLabels.join(' + ')}
                        </div>
                      ) : null}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </Card>

      <Card
        title="By person"
        description="Counters are whoever logged them; leads are whoever generated them. The two are the same person for prospecting work, which is what makes the ratio meaningful."
      >
        {personTable.length === 0 ? (
          <EmptyState>Nothing logged by anyone in this period.</EmptyState>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Person</TH>
                <TH className="text-right">Counters</TH>
                <TH className="text-right">Lead-trigger counters</TH>
                <TH className="text-right">Leads generated</TH>
                <TH className="text-right">Bridge %</TH>
              </TR>
            </THead>
            <TBody>
              {personTable.map((person) => (
                <TR key={person.id}>
                  <TD className="font-medium text-slate-900">{person.name}</TD>
                  <TD className="text-right tabular-nums">{number(person.counters)}</TD>
                  <TD className="text-right tabular-nums">{number(person.triggers)}</TD>
                  <TD className="text-right tabular-nums">{number(person.leads)}</TD>
                  <TD className="text-right tabular-nums">
                    {formatRate(rate(person.leads, person.triggers))}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Card
        title="By day"
        description="Newest first. A gap is a day nobody logged, which is worth seeing rather than smoothing away."
      >
        {byDay.length === 0 ? (
          <EmptyState>No counters in this period.</EmptyState>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH className="text-right">Counters</TH>
                <TH className="text-right">Leads created</TH>
              </TR>
            </THead>
            <TBody>
              {byDay.map((row) => {
                const key = dateKey(row.activityDate)
                return (
                  <TR key={key}>
                    <TD>{formatCounterDate(row.activityDate)}</TD>
                    <TD className="text-right tabular-nums">
                      {number(row._sum.count ?? 0)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {number(leadsByDay.get(key) ?? 0)}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </Card>

      {query ? null : (
        <p className="text-xs text-slate-500">
          Tip: every vertical name links through to its funnel with these filters
          carried over.
        </p>
      )}
    </>
  )
}
