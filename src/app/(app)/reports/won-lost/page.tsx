import { can, pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { formatMoney } from '@/lib/format'
import { formatCounterDate } from '@/lib/prospecting/dates'
import { formatRate, rate } from '@/lib/prospecting/metrics'
import { analyticsQuery, leadListHref, resolveAnalytics } from '@/lib/reports/filters'
import { filterOptions, verticalsWithStages } from '@/lib/reports/options'
import { loadWonLost } from '@/lib/reports/data/won-lost'
import { AccessDenied } from '@/components/access-denied'
import { AnalyticsFilterBar } from '@/components/analytics-filters'
import { Bars } from '@/components/charts/bars'
import { ExportButtons } from '@/components/export-buttons'
import { Card, EmptyState, PageHeader } from '@/components/ui/page'
import { Stat, StatRow } from '@/components/ui/stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'

export const metadata = { title: 'Won / lost analysis · Sales CRM' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const number = (value: number) => value.toLocaleString('en-GB')

/**
 * Won / Lost analysis with the lost-reason breakdown (README §29).
 *
 * The only report on the list dated by **when a deal was decided** rather than
 * when it arrived, and the page says so at the top: "12 won in August" and "12 of
 * August's leads have been won" are different sentences, and the dashboard
 * answers the second. Both are right; a sales review goes wrong when nobody knows
 * which one is on screen.
 *
 * The lost reasons are the point. They are master data, so this table reshapes
 * itself when the list is edited — and "no reason recorded" is a row rather than
 * an omission, because it is usually the row worth acting on first.
 */
export default async function WonLostReportPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.REPORT_VIEW)
  if (!viewer) return <AccessDenied what="reports" />

  const params = await searchParams
  const scope = await resolveAnalytics(viewer, params)

  const [report, verticals, options, symbol, canSeeRevenue, canExport] =
    await Promise.all([
      loadWonLost(scope),
      verticalsWithStages(),
      filterOptions(viewer),
      currencySymbol(),
      can(viewer, PERMISSIONS.REPORT_REVENUE),
      can(viewer, PERMISSIONS.DATA_EXPORT),
    ])

  const verticalNames = new Map(
    verticals.map((vertical) => [vertical.id, vertical.name]),
  )

  const query = analyticsQuery({
    ...scope.filters,
    from: scope.range.fromKey,
    to: scope.range.toKey,
  })

  const decided = report.won + report.lost

  return (
    <div className="space-y-5">
      <PageHeader
        title="Won / lost analysis"
        description="Deals decided in this period, and why the lost ones were lost."
        actions={
          canExport ? (
            <ExportButtons report="won-lost" query={query} />
          ) : undefined
        }
      />

      <AnalyticsFilterBar
        action="/reports/won-lost"
        filters={scope.filters}
        from={scope.range.fromKey}
        to={scope.range.toKey}
        options={options}
        // No status filter: this report *is* the status breakdown, and the one
        // choice it could take — Open — describes a lead that has not been
        // decided, which is the population this screen excludes by definition.
        only={['vertical', 'source', 'bde', 'bdm', 'team', 'priority']}
      />

      <p className="text-xs text-slate-500">
        {formatCounterDate(scope.range.from)} to{' '}
        {formatCounterDate(scope.range.to)}, by <strong>close date</strong> — a
        deal created in May and lost in August belongs to August here, and to May
        on the dashboard. The two are answering different questions. Links through
        to the lead list drop the dates for that reason: the list filters on
        creation date and would not contain these rows.
      </p>

      {decided === 0 ? (
        <EmptyState>
          Nothing was won or lost in this period. Marking a lead Won or Lost is
          what puts it here.
        </EmptyState>
      ) : (
        <>
          <StatRow>
            <Stat
              label="Won"
              value={number(report.won)}
              hint={`${formatRate(report.winRate)} of decided deals`}
              href={leadListHref(scope, { status: 'WON' }, false)}
            />
            <Stat
              label="Lost"
              value={number(report.lost)}
              hint={`${formatRate(rate(report.lost, decided))} of decided deals`}
              href={leadListHref(scope, { status: 'LOST' }, false)}
            />
            {/* Both money cards sit behind `report.revenue`. Expected budget on a
                lost deal is a commercial figure like any other, and gating one of
                the two would have been an inconsistency rather than a policy. */}
            {canSeeRevenue ? (
              <>
                <Stat
                  label="Won revenue"
                  value={formatMoney(report.wonValue, symbol)}
                  hint="The same figure the revenue report shows: deal value, or placements for Staffing (decision D8)"
                />
                <Stat
                  label="At stake on lost deals"
                  value={formatMoney(report.lostValue, symbol)}
                  hint="Expected budget, not money lost — nothing was ever agreed on these"
                  tone="muted"
                />
              </>
            ) : (
              <>
                <Stat
                  label="Win rate"
                  value={formatRate(report.winRate)}
                  hint="Won ÷ (won + lost)"
                />
                <Stat
                  label="Decided"
                  value={number(decided)}
                  hint="Deals closed one way or the other in this period"
                  tone="muted"
                />
              </>
            )}
          </StatRow>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card
              title="Why deals were lost"
              description="Master-data reasons, and the leads that carried none."
            >
              {report.reasons.length === 0 ? (
                <EmptyState>Nothing was lost in this period.</EmptyState>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Reason</TH>
                      <TH className="text-right">Leads</TH>
                      <TH className="text-right">Share</TH>
                      {canSeeRevenue ? (
                        <TH className="text-right">At stake</TH>
                      ) : null}
                    </TR>
                  </THead>
                  <TBody>
                    {report.reasons.map((reason) => (
                      <TR key={reason.id ?? 'none'}>
                        <TD
                          className={
                            reason.id
                              ? 'font-medium text-slate-900'
                              : 'text-slate-500'
                          }
                        >
                          {reason.name}
                        </TD>
                        <TD className="text-right tabular-nums">
                          {number(reason.count)}
                        </TD>
                        <TD className="text-right tabular-nums">
                          {reason.share.toFixed(1)}%
                        </TD>
                        {canSeeRevenue ? (
                          <TD className="text-right tabular-nums">
                            {reason.value > 0
                              ? formatMoney(reason.value, symbol)
                              : '—'}
                          </TD>
                        ) : null}
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </Card>

            <Card
              title="Outcome by vertical"
              description="Won against lost, on one scale, for the verticals that closed anything."
            >
              <Bars
                bars={report.byVertical.flatMap((row) => [
                  {
                    key: `won:${row.verticalId}`,
                    label: `${verticalNames.get(row.verticalId) ?? 'Retired vertical'} — won`,
                    value: row.won,
                    note: formatRate(row.winRate),
                    tone: 'won' as const,
                    href: leadListHref(
                      scope,
                      { vertical: row.verticalId, status: 'WON' },
                      false,
                    ),
                  },
                  {
                    key: `lost:${row.verticalId}`,
                    label: `${verticalNames.get(row.verticalId) ?? 'Retired vertical'} — lost`,
                    value: row.lost,
                    tone: 'lost' as const,
                    href: leadListHref(
                      scope,
                      { vertical: row.verticalId, status: 'LOST' },
                      false,
                    ),
                  },
                ])}
                emptyLabel="Nothing closed in this period."
              />
            </Card>
          </div>

          <Card
            title="Sales cycle"
            description="Days from the lead being created to it being closed, averaged over the deals decided in this period."
          >
            <StatRow>
              <Stat
                label="Average, won"
                value={
                  report.cycle.won === null
                    ? '—'
                    : `${report.cycle.won.toFixed(1)} days`
                }
                hint="Creation to win"
              />
              <Stat
                label="Average, lost"
                value={
                  report.cycle.lost === null
                    ? '—'
                    : `${report.cycle.lost.toFixed(1)} days`
                }
                hint="Creation to loss — a short number here is a qualification problem, a long one is a chasing problem"
              />
              <Stat
                label="Deals in the average"
                value={number(report.cycle.sampled)}
                hint={
                  report.cycle.capped
                    ? 'Capped at the most recent 2,000 closes'
                    : 'Every deal decided in the period'
                }
                tone="muted"
              />
            </StatRow>
          </Card>
        </>
      )}
    </div>
  )
}
