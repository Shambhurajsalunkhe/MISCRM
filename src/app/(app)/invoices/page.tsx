import { prisma } from '@/lib/db'
import { can, pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { leadChildVisibilityFilter } from '@/lib/visibility'
import { formatDate, formatMoney } from '@/lib/format'
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  INVOICE_STATUSES,
} from '@/lib/commercials/display'
import { daysOverdue, displayStatus, overdueWhere } from '@/lib/commercials/overdue'
import { invoiceTotals } from '@/lib/commercials/revenue'
import { AccessDenied } from '@/components/access-denied'
import { Badge } from '@/components/ui/badge'
import { ButtonLink } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/field'
import { EmptyState, PageHeader } from '@/components/ui/page'
import { Stat, StatRow } from '@/components/ui/stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import type { InvoiceStatus } from '@/generated/prisma/enums'
import { SweepButton } from './sweep-button'

export const metadata = { title: 'Invoices · Sales CRM' }

type SearchParams = Promise<{ status?: string; q?: string }>

const PAGE_SIZE = 100

/**
 * The invoice register (docs/03 §1).
 *
 * The status chip on each row is *derived* at render time rather than read off
 * the column — see `src/lib/commercials/overdue.ts`. An invoice that fell due
 * overnight reads as overdue here whether or not the sweep has run, because a
 * collections screen that says Pending about a late invoice is worse than one
 * with no chip at all. The `Overdue` filter uses the same predicate, so the
 * chips and the filter can never disagree.
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.COMMERCIAL_MANAGE)
  if (!viewer) return <AccessDenied what="invoices" />

  const { status, q } = await searchParams
  const search = q?.trim() ?? ''

  const statusFilter = INVOICE_STATUSES.includes(status as InvoiceStatus)
    ? (status as InvoiceStatus)
    : null

  const scope = await leadChildVisibilityFilter(viewer)

  const statusWhere =
    statusFilter === 'OVERDUE'
      ? overdueWhere()
      : statusFilter
        ? { status: statusFilter }
        : {}

  const where = {
    ...scope,
    ...statusWhere,
    ...(search
      ? {
          OR: [
            {
              invoiceNumber: { contains: search, mode: 'insensitive' as const },
            },
            {
              lead: {
                leadCode: { contains: search, mode: 'insensitive' as const },
              },
            },
            {
              client: {
                companyName: { contains: search, mode: 'insensitive' as const },
              },
            },
          ],
        }
      : {}),
  }

  const [invoices, total, totals, symbol, canSweep] = await Promise.all([
    prisma.invoice.findMany({
      where,
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        dueDate: true,
        totalAmount: true,
        amountReceived: true,
        amountPending: true,
        status: true,
        client: { select: { id: true, companyName: true } },
        lead: {
          select: {
            id: true,
            leadCode: true,
            assignedTo: { select: { name: true } },
            vertical: { select: { name: true } },
          },
        },
      },
      // Oldest due first: the register is a work queue, and the thing that has
      // been owed longest is the thing to chase.
      orderBy: [{ dueDate: 'asc' }, { invoiceDate: 'desc' }],
      take: PAGE_SIZE,
    }),
    prisma.invoice.count({ where }),
    invoiceTotals(where),
    currencySymbol(),
    can(viewer, PERMISSIONS.ADMIN_MASTER),
  ])

  const now = new Date()

  return (
    <div className="space-y-5">
      <PageHeader
        title="Invoices"
        description="What has been billed, what has been collected and what is still owed. Cancelled invoices stay in the list and out of the totals."
        actions={
          <>
            {canSweep ? <SweepButton /> : null}
            <ButtonLink href="/invoices/new" size="sm">
              New invoice
            </ButtonLink>
          </>
        }
      />

      <form
        method="get"
        className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3"
      >
        <div>
          <label
            htmlFor="q"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Search
          </label>
          <Input
            id="q"
            name="q"
            defaultValue={search}
            placeholder="Invoice number, lead code or client"
            className="w-64"
          />
        </div>
        <div>
          <label
            htmlFor="status"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Status
          </label>
          <Select id="status" name="status" defaultValue={statusFilter ?? ''}>
            <option value="">Any</option>
            {INVOICE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {INVOICE_STATUS_LABELS[value]}
              </option>
            ))}
          </Select>
        </div>
        <button
          type="submit"
          className="h-9 rounded-md border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Apply
        </button>
        <ButtonLink href="/invoices" variant="ghost">
          Clear
        </ButtonLink>
      </form>

      <StatRow>
        <Stat
          label="Invoiced"
          value={formatMoney(totals.invoiced, symbol)}
          hint={`${totals.count} live invoice${totals.count === 1 ? '' : 's'}`}
        />
        <Stat
          label="Collected"
          value={formatMoney(totals.collected, symbol)}
          hint="SUM(Payment.amount) — docs/02 §5"
        />
        <Stat
          label="Pending"
          value={formatMoney(totals.pending, symbol)}
          hint="Still owed on live invoices"
        />
        <Stat
          label="Overdue"
          value={formatMoney(totals.overdue, symbol)}
          hint={`${totals.overdueCount} invoice${totals.overdueCount === 1 ? '' : 's'} past due`}
          tone={totals.overdueCount === 0 ? 'muted' : 'default'}
        />
      </StatRow>

      {invoices.length === 0 ? (
        <EmptyState>
          No invoices match. Clear the filters, or raise the first one.
        </EmptyState>
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Invoice</TH>
                <TH>Client</TH>
                <TH>Owner</TH>
                <TH>Raised</TH>
                <TH>Due</TH>
                <TH className="text-right">Total</TH>
                <TH className="text-right">Received</TH>
                <TH className="text-right">Outstanding</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {invoices.map((invoice) => {
                const shown = displayStatus(invoice, now)
                const late = shown === 'OVERDUE' ? daysOverdue(invoice.dueDate, now) : 0

                return (
                  <TR
                    key={invoice.id}
                    className={shown === 'OVERDUE' ? 'bg-red-50/40' : undefined}
                  >
                    <TD>
                      <a
                        href={`/invoices/${invoice.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {invoice.invoiceNumber}
                      </a>
                      <div className="text-xs text-slate-500">
                        <a
                          href={`/leads/${invoice.lead.id}`}
                          className="hover:underline"
                        >
                          {invoice.lead.leadCode}
                        </a>
                        {` · ${invoice.lead.vertical.name}`}
                      </div>
                    </TD>
                    <TD>
                      <a
                        href={`/clients/${invoice.client.id}`}
                        className="text-slate-700 hover:underline"
                      >
                        {invoice.client.companyName}
                      </a>
                    </TD>
                    <TD className="text-slate-600">
                      {invoice.lead.assignedTo?.name ?? 'Unassigned'}
                    </TD>
                    <TD className="text-slate-600">
                      {formatDate(invoice.invoiceDate)}
                    </TD>
                    <TD className="text-slate-600">
                      {formatDate(invoice.dueDate)}
                      {late > 0 ? (
                        <div className="text-xs text-red-700">
                          {late} day{late === 1 ? '' : 's'} late
                        </div>
                      ) : null}
                    </TD>
                    <TD className="text-right text-slate-700">
                      {formatMoney(invoice.totalAmount, symbol)}
                    </TD>
                    <TD className="text-right text-slate-600">
                      {formatMoney(invoice.amountReceived, symbol)}
                    </TD>
                    <TD className="text-right font-medium text-slate-900">
                      {formatMoney(invoice.amountPending, symbol)}
                    </TD>
                    <TD>
                      <Badge tone={INVOICE_STATUS_TONES[shown]}>
                        {INVOICE_STATUS_LABELS[shown]}
                      </Badge>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>

          <p className="text-xs text-slate-500">
            Showing {invoices.length} of {total} invoices
            {total > PAGE_SIZE ? ' — narrow the filters to see the rest' : ''}.
          </p>
        </>
      )}
    </div>
  )
}
