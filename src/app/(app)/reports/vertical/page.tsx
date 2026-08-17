import { can, pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { formatMoney } from '@/lib/format'
import { formatCounterDate } from '@/lib/prospecting/dates'
import { counterTotals, formatRate, rate } from '@/lib/prospecting/metrics'
import {
  analyticsQuery,
  leadListHref,
  peopleScopeOf,
  resolveAnalytics,
} from '@/lib/reports/filters'
import { revenueTotals } from '@/lib/reports/kpis'
import {
  filterOptions,
  leadTriggerLabel,
  leadTriggerMetric,
  verticalsWithStages,
} from '@/lib/reports/options'
import { groupedPerformance } from '@/lib/reports/data/grouped'
import { AccessDenied } from '@/components/access-denied'
import { AnalyticsFilterBar } from '@/components/analytics-filters'
import { Bars } from '@/components/charts/bars'
import { ExportButtons } from '@/components/export-buttons'
import { Card, EmptyState, PageHeader } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'

export const metadata = { title: 'Vertical performance · Sales CRM' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const number = (value: number) => value.toLocaleString('en-GB')

/**
 * Vertical Performance (README §25, docs/03 §1) — every vertical side by side.
 *
 * The comparison the dashboard's Conversion by Vertical panel starts and this
 * report finishes: the same intake and conversion columns, plus the money and the
 * open pipeline behind each vertical. Every row is one link away from the leads
 * that made it.
 *
 * The rows come from `SalesVertical`, so a ninth vertical added in Master Data
 * appears here with no code change, and a deactivated one drops out. Verticals
 * with nothing in the period are still listed — "Cold Calling did nothing in
 * August" is a finding, and a report that silently omits the row makes it
 * invisible.
 */
export default async function VerticalReportPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.REPORT_VIEW)
  if (!viewer) return <AccessDenied what="reports" />

  const params = await searchParams
  const scope = await resolveAnalytics(viewer, params)

  const [rows, verticals, options, symbol, canSeeRevenue, canExport] =
    await Promise.all([
      groupedPerformance(scope, 'verticalId', ['WON']),
      verticalsWithStages(),
      filterOptions(viewer),
      currencySymbol(),
      can(viewer, PERMISSIONS.REPORT_REVENUE),
      can(viewer, PERMISSIONS.DATA_EXPORT),
    ])

  const [counters, revenue] = await Promise.all([
    counterTotals(scope.range, peopleScopeOf(scope), scope.verticalId),
    canSeeRevenue ? revenueTotals(scope) : Promise.resolve(null),
  ])

  const byKey = new Map(rows.map((row) => [row.key, row]))
  const query = analyticsQuery({
    ...scope.filters,
    from: scope.range.fromKey,
    to: scope.range.toKey,
  })

  const listed = verticals.filter(
    (vertical) => scope.verticalId === null || vertical.id === scope.verticalId,
  )

  const totals = listed.reduce(
    (carry, vertical) => {
      const row = byKey.get(vertical.id)
      const money = revenue?.byVertical.get(vertical.id)
      return {
        leads: carry.leads + (row?.counts.total ?? 0),
        open: carry.open + (row?.counts.open ?? 0),
        won: carry.won + (row?.reached.WON ?? 0),
        lost: carry.lost + (row?.counts.lost ?? 0),
        pipeline: carry.pipeline + (row?.pipeline ?? 0),
        wonRevenue: carry.wonRevenue + (row?.wonRevenue ?? 0),
        collected: carry.collected + (money?.collected ?? 0),
        pending: carry.pending + (money?.pending ?? 0),
      }
    },
    {
      leads: 0,
      open: 0,
      won: 0,
      lost: 0,
      pipeline: 0,
      wonRevenue: 0,
      collected: 0,
      pending: 0,
    },
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vertical performance"
        description="Every vertical against the others: what went in above the line, what came out below it, and what it was worth."
        actions={
          canExport ? <ExportButtons report="vertical" query={query} /> : undefined
        }
      />

      <AnalyticsFilterBar
        action="/reports/vertical"
        filters={scope.filters}
        from={scope.range.fromKey}
        to={scope.range.toKey}
        options={options}
      />

      <p className="text-xs text-slate-500">
        {formatCounterDate(scope.range.from)} to{' '}
        {formatCounterDate(scope.range.to)}. Leads are counted by the day they
        were created; Won by the day the lead reached its winning stage, so the
        Won column is not a subset of the Leads column beside it. Pipeline value
        is as at today.
      </p>

      {listed.length === 0 ? (
        <EmptyState>No active verticals.</EmptyState>
      ) : (
        <>
          <Card title="Every vertical, side by side">
            <Table>
              <THead>
                <TR>
                  <TH>Vertical</TH>
                  <TH>Input metric</TH>
                  <TH className="text-right">Input</TH>
                  <TH className="text-right">Leads</TH>
                  <TH className="text-right">Bridge</TH>
                  <TH className="text-right">Open</TH>
                  <TH className="text-right">Won</TH>
                  <TH className="text-right">Lost</TH>
                  <TH className="text-right">Conversion</TH>
                  <TH className="text-right">Pipeline</TH>
                  {canSeeRevenue ? (
                    <>
                      <TH className="text-right">Won revenue</TH>
                      <TH className="text-right">Collected</TH>
                      <TH className="text-right">Pending</TH>
                    </>
                  ) : null}
                </TR>
              </THead>
              <TBody>
                {listed.map((vertical) => {
                  const row = byKey.get(vertical.id)
                  const money = revenue?.byVertical.get(vertical.id)
                  const trigger = leadTriggerMetric(vertical.metrics)
                  const input = trigger.metric
                    ? (counters.get(trigger.metric.id) ?? 0)
                    : null
                  const leads = row?.counts.total ?? 0
                  const won = row?.reached.WON ?? 0

                  return (
                    <TR key={vertical.id}>
                      <TD className="font-medium text-slate-900">
                        <a
                          href={leadListHref(scope, { vertical: vertical.id })}
                          className="hover:underline"
                        >
                          {vertical.name}
                        </a>
                      </TD>
                      <TD className="text-slate-500">
                        {leadTriggerLabel(trigger)}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {input === null ? '—' : number(input)}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {number(leads)}
                      </TD>
                      {/* The bridge: how many of those counters became a lead
                          worth tracking (decision D1). Blank where the vertical
                          has no counters, rather than 0% or 100%. */}
                      <TD className="text-right tabular-nums text-slate-500">
                        {input === null ? '—' : formatRate(rate(leads, input))}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {number(row?.counts.open ?? 0)}
                      </TD>
                      <TD className="text-right tabular-nums">{number(won)}</TD>
                      <TD className="text-right tabular-nums">
                        {number(row?.counts.lost ?? 0)}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {formatRate(rate(won, leads))}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {formatMoney(row?.pipeline ?? 0, symbol)}
                      </TD>
                      {canSeeRevenue ? (
                        <>
                          <TD className="text-right tabular-nums">
                            {formatMoney(row?.wonRevenue ?? 0, symbol)}
                          </TD>
                          <TD className="text-right tabular-nums">
                            {formatMoney(money?.collected ?? 0, symbol)}
                          </TD>
                          <TD className="text-right tabular-nums">
                            {formatMoney(money?.pending ?? 0, symbol)}
                          </TD>
                        </>
                      ) : null}
                    </TR>
                  )
                })}
              </TBody>
              <tfoot className="border-t border-slate-300 bg-slate-50 font-medium">
                <TR>
                  <TD className="text-slate-900">All verticals</TD>
                  <TD />
                  <TD />
                  <TD className="text-right tabular-nums">
                    {number(totals.leads)}
                  </TD>
                  <TD />
                  <TD className="text-right tabular-nums">
                    {number(totals.open)}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {number(totals.won)}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {number(totals.lost)}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {formatRate(rate(totals.won, totals.leads))}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {formatMoney(totals.pipeline, symbol)}
                  </TD>
                  {canSeeRevenue ? (
                    <>
                      <TD className="text-right tabular-nums">
                        {formatMoney(totals.wonRevenue, symbol)}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {formatMoney(totals.collected, symbol)}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {formatMoney(totals.pending, symbol)}
                      </TD>
                    </>
                  ) : null}
                </TR>
              </tfoot>
            </Table>
            {/* The input column is deliberately not totalled. Pitches, calls and
                emails are different units, and their sum is a number with no
                meaning — the one figure on this table that would be worse for
                being there. */}
            <p className="mt-3 text-xs text-slate-500">
              The input column is not totalled: pitches, calls and campaigns are
              different units and their sum would mean nothing.
            </p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card
              title="Leads created"
              description="One scale across both charts, so the two are comparable."
            >
              <Bars
                bars={listed.map((vertical) => ({
                  key: vertical.id,
                  label: vertical.name,
                  value: byKey.get(vertical.id)?.counts.total ?? 0,
                  href: leadListHref(scope, { vertical: vertical.id }),
                }))}
                max={totals.leads}
              />
            </Card>

            <Card
              title="Won"
              description="Leads that reached the winning stage in this period."
            >
              <Bars
                bars={listed.map((vertical) => ({
                  key: vertical.id,
                  label: vertical.name,
                  value: byKey.get(vertical.id)?.reached.WON ?? 0,
                  href: leadListHref(scope, {
                    vertical: vertical.id,
                    status: 'WON',
                  }),
                  tone: 'won',
                }))}
                max={totals.leads}
              />
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
