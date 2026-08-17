import { can, pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { formatMoney } from '@/lib/format'
import { formatCounterDate } from '@/lib/prospecting/dates'
import { formatRate, rate } from '@/lib/prospecting/metrics'
import { analyticsQuery, leadListHref, resolveAnalytics } from '@/lib/reports/filters'
import { pipelineValue, revenueTotals } from '@/lib/reports/kpis'
import { filterOptions, verticalsWithStages } from '@/lib/reports/options'
import { AccessDenied } from '@/components/access-denied'
import { AnalyticsFilterBar } from '@/components/analytics-filters'
import { Bars } from '@/components/charts/bars'
import { ExportButtons } from '@/components/export-buttons'
import { ButtonLink } from '@/components/ui/button'
import { Card, PageHeader } from '@/components/ui/page'
import { Stat, StatRow } from '@/components/ui/stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'

export const metadata = { title: 'Revenue · Sales CRM' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * Revenue — Pipeline / Won / Collected / Pending (README §29, docs/02 §5).
 *
 * The four figures Phase 5 started maintaining, in one place and per vertical.
 * What this report exists to make visible is the *relationship* between them,
 * which no single card can show:
 *
 *   Pipeline   what is still in play, as at today
 *   Won        booked in the period — deal value, or placements for Staffing
 *   Invoiced   raised against those deals
 *   Collected  actually received in the period
 *   Pending    still owed, as at today
 *
 * Q11 is what makes the last three comparable to the second: invoicing is on for
 * every vertical, so `Collected + Pending` reconciles to `Won` everywhere rather
 * than in three verticals out of eight. Where it does not reconcile the gap is
 * real — a won deal nobody has invoiced — and the reconciliation panel names it
 * rather than rounding it away. That gap is the single most useful number here.
 *
 * Behind `report.revenue`, the permission the matrix gives to BDM and up.
 */
export default async function RevenueReportPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.REPORT_REVENUE)
  if (!viewer) return <AccessDenied what="revenue reports" />

  const params = await searchParams
  const scope = await resolveAnalytics(viewer, params)

  const [revenue, pipeline, verticals, options, symbol, canExport] =
    await Promise.all([
      revenueTotals(scope),
      pipelineValue(scope),
      verticalsWithStages(),
      filterOptions(viewer),
      currencySymbol(),
      can(viewer, PERMISSIONS.DATA_EXPORT),
    ])

  const query = analyticsQuery({
    ...scope.filters,
    from: scope.range.fromKey,
    to: scope.range.toKey,
  })

  const listed = verticals.filter(
    (vertical) => scope.verticalId === null || vertical.id === scope.verticalId,
  )

  const totals = {
    pipeline: pipeline.total,
    won: revenue.totals.won,
    invoiced: revenue.totals.invoiced,
    collected: revenue.totals.collected,
    pending: revenue.totals.pending,
    overdue: revenue.totals.overdue,
  }

  const uninvoiced = Math.max(totals.won - totals.invoiced, 0)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Revenue"
        description="Pipeline, Won, Collected and Pending — the four figures of docs/02 §5, per vertical and reconciled."
        actions={
          <div className="flex gap-2">
            <ButtonLink href="/invoices" variant="secondary">
              Invoice register
            </ButtonLink>
            {canExport ? <ExportButtons report="revenue" query={query} /> : null}
          </div>
        }
      />

      <AnalyticsFilterBar
        action="/reports/revenue"
        filters={scope.filters}
        from={scope.range.fromKey}
        to={scope.range.toKey}
        options={options}
      />

      <p className="text-xs text-slate-500">
        {formatCounterDate(scope.range.from)} to{' '}
        {formatCounterDate(scope.range.to)}. <strong>Won</strong> and{' '}
        <strong>Collected</strong> are flows — dated by the day the deal closed,
        the day a candidate joined, the day the money arrived.{' '}
        <strong>Pipeline</strong>, <strong>Invoiced</strong> and{' '}
        <strong>Pending</strong> are stocks, as at today, and do not move with the
        date range. Mixing the two is the one mistake this report is arranged to
        prevent.
      </p>

      <StatRow>
        <Stat
          label="Pipeline value"
          value={formatMoney(totals.pipeline, symbol)}
          hint={`${pipeline.leads.toLocaleString('en-GB')} open leads, as at today`}
          href={leadListHref(scope, { status: 'OPEN' }, false)}
        />
        <Stat
          label="Won revenue"
          value={formatMoney(totals.won, symbol)}
          hint="Booked in this period"
        />
        <Stat
          label="Collected"
          value={formatMoney(totals.collected, symbol)}
          hint="Payments received in this period"
        />
        <Stat
          label="Pending"
          value={formatMoney(totals.pending, symbol)}
          hint={
            totals.overdue > 0
              ? `${formatMoney(totals.overdue, symbol)} overdue`
              : 'Nothing overdue'
          }
          href="/invoices"
        />
      </StatRow>

      <Card
        title="Reconciliation"
        description="What was won against what has been billed for. Q11 settled invoicing on for every vertical precisely so this can be read without an asterisk."
      >
        <StatRow>
          <Stat
            label="Won in period"
            value={formatMoney(totals.won, symbol)}
            hint="The benchmark"
          />
          <Stat
            label="Invoiced"
            value={formatMoney(totals.invoiced, symbol)}
            hint="Raised on live invoices, all dates"
          />
          <Stat
            label="Won with no invoice"
            value={formatMoney(uninvoiced, symbol)}
            hint={
              uninvoiced > 0
                ? 'Work sold that nobody has billed for yet'
                : 'Everything won has been billed'
            }
            tone={uninvoiced > 0 ? 'default' : 'muted'}
          />
          <Stat
            label="Collected + pending"
            value={formatMoney(totals.collected + totals.pending, symbol)}
            hint="Should track Won where billing keeps up with closing"
            tone="muted"
          />
        </StatRow>
        {/* Deliberately not framed as an error. Invoices legitimately lag a
            close, and instalment billing means Invoiced can also exceed a single
            period's Won — the comparison is a prompt to look, not a check that
            has failed. */}
        <p className="mt-3 text-xs text-slate-500">
          These will rarely be equal, and need not be: an invoice raised in
          instalments spans periods, and a deal closed on the 30th is usually
          billed in the following month. A gap that persists across several
          periods is the one worth chasing.
        </p>
      </Card>

      <Card title="By vertical">
        <Table>
          <THead>
            <TR>
              <TH>Vertical</TH>
              <TH className="text-right">Pipeline</TH>
              <TH className="text-right">Won</TH>
              <TH className="text-right">Collected</TH>
              <TH className="text-right">Pending</TH>
              <TH className="text-right">Collected ÷ won</TH>
              <TH>Revenue rule</TH>
            </TR>
          </THead>
          <TBody>
            {listed.map((vertical) => {
              const money = revenue.byVertical.get(vertical.id)
              const won = money?.won ?? 0
              const collected = money?.collected ?? 0

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
                  <TD className="text-right tabular-nums">
                    {formatMoney(pipeline.byVertical.get(vertical.id) ?? 0, symbol)}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {formatMoney(won, symbol)}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {formatMoney(collected, symbol)}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {formatMoney(money?.pending ?? 0, symbol)}
                  </TD>
                  <TD className="text-right tabular-nums text-slate-500">
                    {won > 0 ? formatRate(rate(collected, won)) : '—'}
                  </TD>
                  {/* The rule is shown per row because the two are genuinely
                      different, and a reader comparing Staffing's Won against
                      Product Sales' needs to know that one comes from placements
                      and the other from the lead's own deal value (decision D8). */}
                  <TD className="text-xs text-slate-500">
                    {vertical.usesRequirements
                      ? 'Placements'
                      : 'Deal value on won leads'}
                    {vertical.usesInvoicing ? '' : ' · invoicing off'}
                  </TD>
                </TR>
              )
            })}
          </TBody>
          <tfoot className="border-t border-slate-300 bg-slate-50 font-medium">
            <TR>
              <TD className="text-slate-900">All verticals</TD>
              <TD className="text-right tabular-nums">
                {formatMoney(totals.pipeline, symbol)}
              </TD>
              <TD className="text-right tabular-nums">
                {formatMoney(totals.won, symbol)}
              </TD>
              <TD className="text-right tabular-nums">
                {formatMoney(totals.collected, symbol)}
              </TD>
              <TD className="text-right tabular-nums">
                {formatMoney(totals.pending, symbol)}
              </TD>
              <TD className="text-right tabular-nums">
                {totals.won > 0
                  ? formatRate(rate(totals.collected, totals.won))
                  : '—'}
              </TD>
              <TD />
            </TR>
          </tfoot>
        </Table>
      </Card>

      <Card
        title="Won revenue by vertical"
        description="One scale, so the verticals are comparable. The figure on the right is what has been collected against each."
      >
        <Bars
          bars={listed
            .map((vertical) => {
              const money = revenue.byVertical.get(vertical.id)
              return {
                key: vertical.id,
                label: vertical.name,
                value: Math.round(money?.won ?? 0),
                note: formatMoney(money?.collected ?? 0, symbol),
                href: leadListHref(scope, {
                  vertical: vertical.id,
                  status: 'WON',
                }),
              }
            })
            .sort((a, b) => b.value - a.value)}
          emptyLabel="No revenue booked in this period."
        />
      </Card>
    </div>
  )
}
