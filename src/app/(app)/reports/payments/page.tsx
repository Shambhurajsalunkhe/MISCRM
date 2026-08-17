import { can, pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { formatDate, formatMoney } from '@/lib/format'
import { formatCounterDate } from '@/lib/prospecting/dates'
import { analyticsQuery, resolveAnalytics } from '@/lib/reports/filters'
import { filterOptions } from '@/lib/reports/options'
import { INVOICE_LIMIT, loadPayments } from '@/lib/reports/data/payments'
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
} from '@/lib/commercials/display'
import { AccessDenied } from '@/components/access-denied'
import { AnalyticsFilterBar } from '@/components/analytics-filters'
import { Bars } from '@/components/charts/bars'
import { ExportButtons } from '@/components/export-buttons'
import { Badge } from '@/components/ui/badge'
import { ButtonLink } from '@/components/ui/button'
import { Card, EmptyState, PageHeader } from '@/components/ui/page'
import { Stat, StatRow } from '@/components/ui/stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'

export const metadata = { title: 'Payment status · Sales CRM' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const number = (value: number) => value.toLocaleString('en-GB')

/**
 * Payment Status (README §29) — the collections view.
 *
 * Statuses here are the *derived* ones, not the stored column: Phase 5's second
 * invoice decision. An invoice that fell due overnight reads as overdue on this
 * page whether or not the sweep has run, because a collections report that is
 * wrong for a morning is worse than one with no chips at all.
 *
 * The two halves are dated differently and both say so. The table and the status
 * split cover invoices *raised in the period*; the ageing ladder covers everything
 * *still outstanding now*, whenever it was raised — restricting that to the window
 * would hide exactly the March invoice somebody opened this report to find.
 */
export default async function PaymentsReportPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.REPORT_REVENUE)
  if (!viewer) return <AccessDenied what="revenue reports" />

  const params = await searchParams
  const scope = await resolveAnalytics(viewer, params)

  const [report, options, symbol, canExport] = await Promise.all([
    loadPayments(scope),
    filterOptions(viewer),
    currencySymbol(),
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
        title="Payment status"
        description="What was billed, what has been received, and how late the rest is."
        actions={
          <div className="flex gap-2">
            <ButtonLink href="/invoices" variant="secondary">
              Invoice register
            </ButtonLink>
            {canExport ? (
              <ExportButtons report="payments" query={query} />
            ) : null}
          </div>
        }
      />

      <AnalyticsFilterBar
        action="/reports/payments"
        filters={scope.filters}
        from={scope.range.fromKey}
        to={scope.range.toKey}
        options={options}
        // No status or priority: those are lead attributes, and an invoice's own
        // status is what the table below is grouped by.
        only={['vertical', 'source', 'bde', 'bdm', 'team']}
      />

      <p className="text-xs text-slate-500">
        Invoices <strong>raised</strong> between{' '}
        {formatCounterDate(scope.range.from)} and{' '}
        {formatCounterDate(scope.range.to)}. The ageing ladder below covers
        everything still outstanding <strong>today</strong>, whenever it was
        raised — money owed does not stop being owed because a report was narrowed
        to last month.
      </p>

      <StatRow>
        <Stat
          label="Invoiced in period"
          value={formatMoney(report.raised.total, symbol)}
          hint={`${number(report.raised.count)} live invoices`}
        />
        <Stat
          label="Received against them"
          value={formatMoney(report.raised.collected, symbol)}
          hint="Payments recorded against this period's invoices, whenever they arrived"
        />
        <Stat
          label="Outstanding now"
          value={formatMoney(report.outstanding.pending, symbol)}
          hint={`${number(report.outstanding.count)} invoices with money owed, all dates`}
        />
        <Stat
          label="Overdue now"
          value={formatMoney(report.outstanding.overdue, symbol)}
          hint={`${number(report.outstanding.overdueCount)} past their due date`}
          href="/invoices?status=OVERDUE"
        />
      </StatRow>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Ageing"
          description="Everything still owed, by how late it is. Invoices with no due date sit in 'not yet due' — nobody has said when they are payable."
        >
          <Bars
            bars={report.ageing.map((bucket) => ({
              key: bucket.label,
              label: bucket.label,
              value: Math.round(bucket.amount),
              note: `${bucket.count}`,
              tone:
                bucket.label === 'Not yet due'
                  ? 'muted'
                  : bucket.label === 'Over 90 days'
                    ? 'lost'
                    : 'default',
            }))}
            emptyLabel="Nothing outstanding."
          />
          <p className="mt-3 text-xs text-slate-500">
            The figure on the right of each bar is the number of invoices in that
            band.
          </p>
        </Card>

        <Card
          title="Status split"
          description="Invoices raised in this period, by their status as at right now."
        >
          {report.byStatus.length === 0 ? (
            <EmptyState>No invoices raised in this period.</EmptyState>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Status</TH>
                  <TH className="text-right">Invoices</TH>
                  <TH className="text-right">Billed</TH>
                  <TH className="text-right">Still owed</TH>
                </TR>
              </THead>
              <TBody>
                {report.byStatus.map((row) => (
                  <TR key={row.status}>
                    <TD>
                      <Badge tone={INVOICE_STATUS_TONES[row.status]}>
                        {INVOICE_STATUS_LABELS[row.status]}
                      </Badge>
                    </TD>
                    <TD className="text-right tabular-nums">
                      {number(row.count)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {formatMoney(row.total, symbol)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {formatMoney(row.pending, symbol)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>

      <Card
        title="Invoices raised in this period"
        description="Soonest due first. Cancelled invoices are listed — one raised and withdrawn is part of what happened — but never counted in the money above."
      >
        {report.rows.length === 0 ? (
          <EmptyState>
            No invoices were raised in this period. They are created from a
            lead&apos;s Commercials tab, a contract, a quotation or a placement.
          </EmptyState>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Invoice</TH>
                <TH>Client</TH>
                <TH>Lead</TH>
                <TH>Vertical</TH>
                <TH>Raised</TH>
                <TH>Due</TH>
                <TH className="text-right">Total</TH>
                <TH className="text-right">Received</TH>
                <TH className="text-right">Owed</TH>
                <TH>Status</TH>
                <TH className="text-right">Days late</TH>
              </TR>
            </THead>
            <TBody>
              {report.rows.map((row) => (
                <TR key={row.id}>
                  <TD className="font-medium text-slate-900">
                    <a href={`/invoices/${row.id}`} className="hover:underline">
                      {row.invoiceNumber}
                    </a>
                  </TD>
                  <TD>{row.client}</TD>
                  <TD>
                    <a
                      href={`/leads/${row.leadId}`}
                      className="text-slate-600 hover:underline"
                    >
                      {row.leadCode}
                    </a>
                  </TD>
                  <TD className="text-slate-500">{row.vertical}</TD>
                  <TD className="text-slate-500">
                    {formatDate(row.invoiceDate)}
                  </TD>
                  <TD className="text-slate-500">{formatDate(row.dueDate)}</TD>
                  <TD className="text-right tabular-nums">
                    {formatMoney(row.total, symbol)}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {formatMoney(row.received, symbol)}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {formatMoney(row.pending, symbol)}
                  </TD>
                  <TD>
                    <Badge tone={INVOICE_STATUS_TONES[row.status]}>
                      {INVOICE_STATUS_LABELS[row.status]}
                    </Badge>
                  </TD>
                  <TD className="text-right tabular-nums">
                    {row.daysOverdue > 0 ? number(row.daysOverdue) : '—'}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {report.truncated ? (
          <p className="mt-3 text-xs text-amber-700">
            More than {number(INVOICE_LIMIT)} invoices matched; the{' '}
            {number(INVOICE_LIMIT)} soonest due are listed. The ageing figures
            above are computed over all of them.
          </p>
        ) : null}
      </Card>
    </div>
  )
}
