import { can, pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { formatMoney } from '@/lib/format'
import { formatCounterDate } from '@/lib/prospecting/dates'
import { formatRate } from '@/lib/prospecting/metrics'
import { analyticsQuery, leadListHref, resolveAnalytics } from '@/lib/reports/filters'
import { filterOptions } from '@/lib/reports/options'
import { loadDemos } from '@/lib/reports/data/demos'
import { DEMO_STATUS_LABELS } from '@/lib/commercials/display'
import { AccessDenied } from '@/components/access-denied'
import { AnalyticsFilterBar } from '@/components/analytics-filters'
import { Bars } from '@/components/charts/bars'
import { ExportButtons } from '@/components/export-buttons'
import { Card, EmptyState, PageHeader } from '@/components/ui/page'
import { Stat, StatRow } from '@/components/ui/stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'

export const metadata = { title: 'Product demos · Sales CRM' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const number = (value: number) => value.toLocaleString('en-GB')

/**
 * Product demos (README §20, docs/02 §4.6) — inquiries, demos, proposals, orders
 * and order value.
 *
 * Which verticals appear is read off the `usesDemos` / `usesQuotations` module
 * switches rather than from a list of codes, so a team that turns demos on for
 * another vertical gets its row the same day.
 *
 * Decision D11 is the shape of this report: 120 demos against 60 leads means a
 * demo cannot be a stage, so it is a repeatable child record and the counts are in
 * two different units. "Demos" counts demos; "leads with a demo" counts leads —
 * and Inquiry → Demo % uses the second, because it asks how many enquiries we
 * actually got in front of rather than how many meetings we held.
 */
export default async function ProductDemosReportPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.REPORT_VIEW)
  if (!viewer) return <AccessDenied what="reports" />

  const params = await searchParams
  const scope = await resolveAnalytics(viewer, params)

  const [report, options, symbol, canSeeRevenue, canExport] = await Promise.all([
    loadDemos(scope),
    filterOptions(viewer),
    currencySymbol(),
    can(viewer, PERMISSIONS.REPORT_REVENUE),
    can(viewer, PERMISSIONS.DATA_EXPORT),
  ])

  const query = analyticsQuery({
    ...scope.filters,
    from: scope.range.fromKey,
    to: scope.range.toKey,
  })

  return (
    <div className="space-y-5">
      <PageHeader
        title="Product demos"
        description="Inquiries, demos held, proposals shared and orders won — for every vertical with demos or quotations switched on."
        actions={
          canExport ? (
            <ExportButtons report="product-demos" query={query} />
          ) : undefined
        }
      />

      <AnalyticsFilterBar
        action="/reports/product-demos"
        filters={scope.filters}
        from={scope.range.fromKey}
        to={scope.range.toKey}
        options={options}
      />

      <p className="text-xs text-slate-500">
        {formatCounterDate(scope.range.from)} to{' '}
        {formatCounterDate(scope.range.to)}. Inquiries are leads created in the
        period; demos are dated by when they were <strong>scheduled</strong>, so a
        demo booked in July and held in August counts in July on both the
        Scheduled and Completed columns. Order value is accepted quotations dated
        by the quote.
      </p>

      {report.noDemoVerticals ? (
        <EmptyState>
          No vertical currently has demos or quotations switched on. An
          administrator turns them on per vertical in Master Data → Verticals.
        </EmptyState>
      ) : (
        <>
          <StatRow>
            <Stat
              label="Product inquiries"
              value={number(report.totals.inquiries)}
              hint="Leads created in this period"
              href={leadListHref(scope)}
            />
            <Stat
              label="Demos scheduled"
              value={number(report.totals.scheduled)}
              hint="Meetings booked, not leads"
            />
            <Stat
              label="Demos completed"
              value={number(report.totals.completed)}
              hint={`${formatRate(
                report.totals.scheduled > 0
                  ? (report.totals.completed / report.totals.scheduled) * 100
                  : null,
              )} of those booked were held`}
            />
            {canSeeRevenue ? (
              <Stat
                label="Order value"
                value={formatMoney(report.totals.orderValue, symbol)}
                hint={
                  report.totals.averageOrderValue === null
                    ? 'Accepted quotations in this period'
                    : `${formatMoney(report.totals.averageOrderValue, symbol)} average per won deal`
                }
              />
            ) : (
              <Stat
                label="Won"
                value={number(report.totals.won)}
                hint="Leads that reached the winning stage in this period"
              />
            )}
          </StatRow>

          <Card
            title="By vertical"
            description="Each column's unit is in its header: demos count meetings, the conversions count leads."
          >
            <Table>
              <THead>
                <TR>
                  <TH>Vertical</TH>
                  <TH className="text-right">Inquiries</TH>
                  <TH className="text-right">Demos scheduled</TH>
                  <TH className="text-right">Demos completed</TH>
                  <TH className="text-right">Leads with a demo</TH>
                  <TH className="text-right">Inquiry → demo</TH>
                  <TH className="text-right">Proposal</TH>
                  <TH className="text-right">Demo → proposal</TH>
                  <TH className="text-right">Negotiation</TH>
                  <TH className="text-right">Won</TH>
                  <TH className="text-right">Inquiry → won</TH>
                  {canSeeRevenue ? (
                    <>
                      <TH className="text-right">Order value</TH>
                      <TH className="text-right">Average order</TH>
                    </>
                  ) : null}
                </TR>
              </THead>
              <TBody>
                {report.rows.map((row) => (
                  <TR key={row.verticalId}>
                    <TD className="font-medium text-slate-900">
                      <a
                        href={leadListHref(scope, { vertical: row.verticalId })}
                        className="hover:underline"
                      >
                        {row.vertical}
                      </a>
                    </TD>
                    <TD className="text-right tabular-nums">
                      {number(row.inquiries)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {number(row.scheduled)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {number(row.completed)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {number(row.leadsWithDemo)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {formatRate(row.inquiryToDemo)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {number(row.reachedProposal)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {formatRate(row.demoToProposal)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {number(row.reachedNegotiation)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {number(row.won)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {formatRate(row.inquiryToWon)}
                    </TD>
                    {canSeeRevenue ? (
                      <>
                        <TD className="text-right tabular-nums">
                          {formatMoney(row.orderValue, symbol)}
                        </TD>
                        <TD className="text-right tabular-nums">
                          {row.averageOrderValue === null
                            ? '—'
                            : formatMoney(row.averageOrderValue, symbol)}
                        </TD>
                      </>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
            {/* Demo → proposal divides by leads with a *completed* demo, per
                §4.6. Dividing by demos held would mix the units and report over
                100% for any lead that was shown the product twice. */}
            <p className="mt-3 text-xs text-slate-500">
              Demo → proposal divides by leads with at least one completed demo,
              not by demos held: a lead shown the product twice is still one lead.
            </p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card
              title="The chain"
              description="Inquiries, the leads that saw a demo, proposals, negotiations and wins — one scale."
            >
              <Bars
                bars={[
                  {
                    key: 'inquiries',
                    label: 'Product inquiries',
                    value: report.totals.inquiries,
                  },
                  {
                    key: 'with-demo',
                    label: 'Leads with a demo',
                    value: report.rows.reduce(
                      (sum, row) => sum + row.leadsWithDemo,
                      0,
                    ),
                  },
                  {
                    key: 'completed',
                    label: 'Leads with a completed demo',
                    value: report.rows.reduce(
                      (sum, row) => sum + row.leadsWithCompletedDemo,
                      0,
                    ),
                  },
                  {
                    key: 'proposal',
                    label: 'Reached proposal',
                    value: report.rows.reduce(
                      (sum, row) => sum + row.reachedProposal,
                      0,
                    ),
                  },
                  {
                    key: 'negotiation',
                    label: 'Reached negotiation',
                    value: report.rows.reduce(
                      (sum, row) => sum + row.reachedNegotiation,
                      0,
                    ),
                  },
                  {
                    key: 'won',
                    label: 'Won',
                    value: report.totals.won,
                    tone: 'won',
                  },
                ]}
              />
            </Card>

            <Card
              title="Demos by outcome"
              description="A no-show is neither a completed demo nor a cancelled one, and the difference is what a demo team is judged on."
            >
              <Bars
                bars={report.byStatus.map(([status, count]) => ({
                  key: status,
                  label: DEMO_STATUS_LABELS[status],
                  value: count,
                  tone:
                    status === 'COMPLETED'
                      ? 'won'
                      : status === 'NO_SHOW'
                        ? 'lost'
                        : 'muted',
                }))}
                emptyLabel="No demos scheduled in this period."
              />
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
