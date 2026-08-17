import { can, pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { formatMoney } from '@/lib/format'
import { formatCounterDate } from '@/lib/prospecting/dates'
import { formatRate, rate } from '@/lib/prospecting/metrics'
import {
  analyticsQuery,
  leadListHref,
  resolveAnalytics,
} from '@/lib/reports/filters'
import { filterOptions } from '@/lib/reports/options'
import {
  counterTotalsByPerson,
  groupedPerformance,
  groupLabels,
} from '@/lib/reports/data/grouped'
import { AccessDenied } from '@/components/access-denied'
import { AnalyticsFilterBar } from '@/components/analytics-filters'
import { Bars } from '@/components/charts/bars'
import { ExportButtons } from '@/components/export-buttons'
import { ButtonLink } from '@/components/ui/button'
import { Card, EmptyState, PageHeader } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'

export const metadata = { title: 'BDE lead generation · Sales CRM' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const number = (value: number) => value.toLocaleString('en-GB')

/**
 * BDE Lead Generation (README §27).
 *
 * The one report that spans decision D1's line per person: the counters somebody
 * logged above it, the leads that came out below it, and the bridge between the
 * two. It is the report the prospecting screens were built to feed, and the
 * reason `ProspectingActivity` is per person and per day rather than a team
 * total.
 *
 * Grouped by `generatedById` — who *sourced* the lead — never by assignee.
 * README §6.3 keeps the two apart for the whole application, and crediting a
 * BDE with a lead handed to them by someone else would make this report worse
 * than no report.
 *
 * Behind `report.performance`, not `report.view`: the permission matrix
 * (docs/03 §2) treats "how is each person doing" as a separate capability from
 * "how is the business doing", and a BDE holds neither.
 */
export default async function BdeReportPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.REPORT_PERFORMANCE)
  if (!viewer) return <AccessDenied what="performance reports" />

  const params = await searchParams
  const scope = await resolveAnalytics(viewer, params)

  const [rows, counters, options, symbol, canSeeRevenue, canExport] =
    await Promise.all([
      groupedPerformance(scope, 'generatedById', ['WON']),
      counterTotalsByPerson(scope),
      filterOptions(viewer),
      currencySymbol(),
      can(viewer, PERMISSIONS.REPORT_REVENUE),
      can(viewer, PERMISSIONS.DATA_EXPORT),
    ])

  // Anyone with counters but no leads still belongs in the table: a week of
  // pitches that produced nothing is the row a manager most needs to see, and
  // grouping only by lead would drop it.
  const keys = new Set([...rows.map((row) => row.key), ...counters.keys()])
  const labels = await groupLabels('generatedById', [...keys])

  const query = analyticsQuery({
    ...scope.filters,
    from: scope.range.fromKey,
    to: scope.range.toKey,
  })

  const people = [...keys]
    .map((key) => {
      const row = rows.find((candidate) => candidate.key === key)
      const logged = counters.get(key) ?? 0
      const leads = row?.counts.total ?? 0

      return {
        key,
        name: labels.get(key) ?? 'Former user',
        logged,
        leads,
        open: row?.counts.open ?? 0,
        won: row?.reached.WON ?? 0,
        lost: row?.counts.lost ?? 0,
        conversion: row?.conversion ?? null,
        pipeline: row?.pipeline ?? 0,
        wonRevenue: row?.wonRevenue ?? 0,
        bridge: rate(leads, logged),
      }
    })
    .sort((a, b) => b.leads - a.leads || b.logged - a.logged)

  const totals = people.reduce(
    (carry, person) => ({
      logged: carry.logged + person.logged,
      leads: carry.leads + person.leads,
      won: carry.won + person.won,
      lost: carry.lost + person.lost,
      pipeline: carry.pipeline + person.pipeline,
      wonRevenue: carry.wonRevenue + person.wonRevenue,
    }),
    { logged: 0, leads: 0, won: 0, lost: 0, pipeline: 0, wonRevenue: 0 },
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title="BDE lead generation"
        description="Counters logged above the line, leads generated below it, and what each person's work converted into."
        actions={
          <div className="flex gap-2">
            <ButtonLink href="/prospecting/summary" variant="secondary">
              Counter summary
            </ButtonLink>
            {canExport ? <ExportButtons report="bde" query={query} /> : null}
          </div>
        }
      />

      <AnalyticsFilterBar
        action="/reports/bde"
        filters={scope.filters}
        from={scope.range.fromKey}
        to={scope.range.toKey}
        options={options}
        // No BDE filter: this report is grouped by BDE, and a filter would
        // reduce its own table to a single row. The team and vertical filters
        // are the ones that narrow it usefully.
        only={['vertical', 'source', 'team', 'status', 'priority']}
      />

      <p className="text-xs text-slate-500">
        {formatCounterDate(scope.range.from)} to{' '}
        {formatCounterDate(scope.range.to)}. Counters are dated by the day the
        work was logged and leads by the day they were created, so the bridge
        percentage is an approximation across the boundary — a pitch sent on the
        31st that got a reply on the 1st counts in different months. The lead
        itself records which counter batch it came from where the BDE said so.
      </p>

      {people.length === 0 ? (
        <EmptyState>
          Nothing logged and no leads created in this period.
        </EmptyState>
      ) : (
        <>
          <Card title="Per person">
            <Table>
              <THead>
                <TR>
                  <TH>Person</TH>
                  <TH className="text-right">Counters logged</TH>
                  <TH className="text-right">Leads generated</TH>
                  <TH className="text-right">Bridge</TH>
                  <TH className="text-right">Open</TH>
                  <TH className="text-right">Won</TH>
                  <TH className="text-right">Lost</TH>
                  <TH className="text-right">Conversion</TH>
                  <TH className="text-right">Pipeline</TH>
                  {canSeeRevenue ? (
                    <TH className="text-right">Won revenue</TH>
                  ) : null}
                </TR>
              </THead>
              <TBody>
                {people.map((person) => (
                  <TR key={person.key}>
                    <TD className="font-medium text-slate-900">
                      <a
                        href={leadListHref(scope, { bde: person.key })}
                        className="hover:underline"
                      >
                        {person.name}
                      </a>
                    </TD>
                    <TD className="text-right tabular-nums">
                      {person.logged === 0 ? '—' : number(person.logged)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {number(person.leads)}
                    </TD>
                    <TD className="text-right tabular-nums text-slate-500">
                      {person.logged === 0 ? '—' : formatRate(person.bridge)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {number(person.open)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {number(person.won)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {number(person.lost)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {formatRate(person.conversion)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {formatMoney(person.pipeline, symbol)}
                    </TD>
                    {canSeeRevenue ? (
                      <TD className="text-right tabular-nums">
                        {formatMoney(person.wonRevenue, symbol)}
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
              <tfoot className="border-t border-slate-300 bg-slate-50 font-medium">
                <TR>
                  <TD className="text-slate-900">Everyone in scope</TD>
                  <TD className="text-right tabular-nums">
                    {number(totals.logged)}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {number(totals.leads)}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {formatRate(rate(totals.leads, totals.logged))}
                  </TD>
                  <TD />
                  <TD className="text-right tabular-nums">
                    {number(totals.won)}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {number(totals.lost)}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {formatRate(rate(totals.won, totals.won + totals.lost))}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {formatMoney(totals.pipeline, symbol)}
                  </TD>
                  {canSeeRevenue ? (
                    <TD className="text-right tabular-nums">
                      {formatMoney(totals.wonRevenue, symbol)}
                    </TD>
                  ) : null}
                </TR>
              </tfoot>
            </Table>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Leads generated">
              <Bars
                bars={people.slice(0, 15).map((person) => ({
                  key: `leads:${person.key}`,
                  label: person.name,
                  value: person.leads,
                  href: leadListHref(scope, { bde: person.key }),
                }))}
              />
            </Card>
            <Card
              title="Counters logged"
              description="Different unit from the chart beside it — pitches, calls and emails together — so the two scales are deliberately independent."
            >
              <Bars
                bars={people.slice(0, 15).map((person) => ({
                  key: `counters:${person.key}`,
                  label: person.name,
                  value: person.logged,
                  tone: 'muted',
                }))}
              />
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
