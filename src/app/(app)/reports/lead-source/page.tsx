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
  groupedPerformance,
  groupLabels,
  UNGROUPED,
} from '@/lib/reports/data/grouped'
import { AccessDenied } from '@/components/access-denied'
import { AnalyticsFilterBar } from '@/components/analytics-filters'
import { Bars } from '@/components/charts/bars'
import { ExportButtons } from '@/components/export-buttons'
import { Card, EmptyState, PageHeader } from '@/components/ui/page'
import { Stat, StatRow } from '@/components/ui/stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'

export const metadata = { title: 'Lead source performance · Sales CRM' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const number = (value: number) => value.toLocaleString('en-GB')

/**
 * Lead Source Performance (README §29).
 *
 * Which sources produce leads, and — the column that actually decides where the
 * next month's effort goes — which produce *won* leads. A source that brings in
 * forty leads and closes none is worse than one that brings four and closes two,
 * and a report showing only the first column says the opposite.
 *
 * "No source recorded" is a row rather than an omission. It is often the largest
 * one, and that is the finding: nobody can act on a source mix where a third of
 * the leads never had a source set.
 */
export default async function LeadSourceReportPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.REPORT_VIEW)
  if (!viewer) return <AccessDenied what="reports" />

  const params = await searchParams
  const scope = await resolveAnalytics(viewer, params)

  const [rows, options, symbol, canSeeRevenue, canExport] = await Promise.all([
    groupedPerformance(scope, 'sourceId', ['WON']),
    filterOptions(viewer),
    currencySymbol(),
    can(viewer, PERMISSIONS.REPORT_REVENUE),
    can(viewer, PERMISSIONS.DATA_EXPORT),
  ])

  const labels = await groupLabels(
    'sourceId',
    rows.map((row) => row.key),
  )

  const query = analyticsQuery({
    ...scope.filters,
    from: scope.range.fromKey,
    to: scope.range.toKey,
  })

  const totals = rows.reduce(
    (carry, row) => ({
      leads: carry.leads + row.counts.total,
      won: carry.won + (row.reached.WON ?? 0),
      lost: carry.lost + row.counts.lost,
      pipeline: carry.pipeline + row.pipeline,
      wonRevenue: carry.wonRevenue + row.wonRevenue,
    }),
    { leads: 0, won: 0, lost: 0, pipeline: 0, wonRevenue: 0 },
  )

  const unattributed = rows.find((row) => row.key === UNGROUPED)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Lead source performance"
        description="Where the leads came from, and which of those sources actually close."
        actions={
          canExport ? (
            <ExportButtons report="lead-source" query={query} />
          ) : undefined
        }
      />

      <AnalyticsFilterBar
        action="/reports/lead-source"
        filters={scope.filters}
        from={scope.range.fromKey}
        to={scope.range.toKey}
        options={options}
      />

      <p className="text-xs text-slate-500">
        {formatCounterDate(scope.range.from)} to{' '}
        {formatCounterDate(scope.range.to)}. Leads by creation date, Won by the
        date the lead reached its winning stage.
      </p>

      {rows.length === 0 ? (
        <EmptyState>
          No leads in this period. Sources are set on the lead form and
          maintained in Master Data → Lead sources.
        </EmptyState>
      ) : (
        <>
          <StatRow>
            <Stat
              label="Sources with leads"
              value={number(rows.filter((row) => row.key !== UNGROUPED).length)}
              hint="Excluding leads with no source recorded"
            />
            <Stat label="Leads" value={number(totals.leads)} />
            <Stat
              label="Won"
              value={number(totals.won)}
              hint={`${formatRate(rate(totals.won, totals.leads))} of leads created`}
            />
            <Stat
              label="No source recorded"
              value={number(unattributed?.counts.total ?? 0)}
              hint={
                unattributed
                  ? `${formatRate(rate(unattributed.counts.total, totals.leads))} of the period's leads`
                  : 'Every lead has a source'
              }
              tone="muted"
            />
          </StatRow>

          <Card title="By source">
            <Table>
              <THead>
                <TR>
                  <TH>Source</TH>
                  <TH className="text-right">Leads</TH>
                  <TH className="text-right">Open</TH>
                  <TH className="text-right">Won</TH>
                  <TH className="text-right">Lost</TH>
                  <TH className="text-right">Won ÷ leads</TH>
                  <TH className="text-right">Conversion</TH>
                  <TH className="text-right">Pipeline</TH>
                  {canSeeRevenue ? (
                    <TH className="text-right">Won revenue</TH>
                  ) : null}
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => {
                  const won = row.reached.WON ?? 0

                  return (
                    <TR key={row.key || 'none'}>
                      <TD className="font-medium text-slate-900">
                        {row.key === UNGROUPED ? (
                          <span className="text-slate-500">
                            No source recorded
                          </span>
                        ) : (
                          <a
                            href={leadListHref(scope, { source: row.key })}
                            className="hover:underline"
                          >
                            {labels.get(row.key) ?? 'Retired source'}
                          </a>
                        )}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {number(row.counts.total)}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {number(row.counts.open)}
                      </TD>
                      <TD className="text-right tabular-nums">{number(won)}</TD>
                      <TD className="text-right tabular-nums">
                        {number(row.counts.lost)}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {formatRate(rate(won, row.counts.total))}
                      </TD>
                      {/* Two different percentages, on purpose. "Won ÷ leads"
                          asks how much of the intake closed; "Conversion" is
                          won ÷ (won + lost), which ignores deals still open and
                          is the only one comparable between a source that has
                          been running for years and one started last month. */}
                      <TD className="text-right tabular-nums">
                        {formatRate(row.conversion)}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {formatMoney(row.pipeline, symbol)}
                      </TD>
                      {canSeeRevenue ? (
                        <TD className="text-right tabular-nums">
                          {formatMoney(row.wonRevenue, symbol)}
                        </TD>
                      ) : null}
                    </TR>
                  )
                })}
              </TBody>
              <tfoot className="border-t border-slate-300 bg-slate-50 font-medium">
                <TR>
                  <TD className="text-slate-900">All sources</TD>
                  <TD className="text-right tabular-nums">
                    {number(totals.leads)}
                  </TD>
                  <TD />
                  <TD className="text-right tabular-nums">
                    {number(totals.won)}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {number(totals.lost)}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {formatRate(rate(totals.won, totals.leads))}
                  </TD>
                  <TD />
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

          <Card
            title="Leads and wins by source"
            description="Same scale on both, so the gap between volume and outcome is the visible part."
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <Bars
                bars={rows.slice(0, 12).map((row) => ({
                  key: `leads:${row.key}`,
                  label:
                    row.key === UNGROUPED
                      ? 'No source recorded'
                      : (labels.get(row.key) ?? 'Retired source'),
                  value: row.counts.total,
                  href:
                    row.key === UNGROUPED
                      ? undefined
                      : leadListHref(scope, { source: row.key }),
                }))}
                max={totals.leads}
              />
              <Bars
                bars={rows.slice(0, 12).map((row) => ({
                  key: `won:${row.key}`,
                  label:
                    row.key === UNGROUPED
                      ? 'No source recorded'
                      : (labels.get(row.key) ?? 'Retired source'),
                  value: row.reached.WON ?? 0,
                  tone: 'won',
                  href:
                    row.key === UNGROUPED
                      ? undefined
                      : leadListHref(scope, { source: row.key, status: 'WON' }),
                }))}
                max={totals.leads}
              />
            </div>
            {rows.length > 12 ? (
              <p className="mt-3 text-xs text-slate-500">
                The twelve busiest sources are charted; the table above has all{' '}
                {number(rows.length)}.
              </p>
            ) : null}
          </Card>
        </>
      )}
    </div>
  )
}
