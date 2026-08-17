import { prisma } from '@/lib/db'
import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { leadChildVisibilityFilter } from '@/lib/visibility'
import { formatDate, formatMoney } from '@/lib/format'
import {
  QUOTATION_STATUS_LABELS,
  QUOTATION_STATUS_TONES,
  QUOTATION_STATUSES,
} from '@/lib/commercials/display'
import { AccessDenied } from '@/components/access-denied'
import { Badge } from '@/components/ui/badge'
import { ButtonLink } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/field'
import { EmptyState, PageHeader } from '@/components/ui/page'
import { Stat, StatRow } from '@/components/ui/stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import type { QuotationStatus } from '@/generated/prisma/enums'

export const metadata = { title: 'Quotations · Sales CRM' }

type SearchParams = Promise<{ status?: string; q?: string }>

const PAGE_SIZE = 100

/**
 * The quotation register (docs/03 §1).
 *
 * Accepted quotations are the numerator of Order Value in docs/02 §4.6
 * (`SUM(Quotation.totalAmount WHERE status = ACCEPTED)`), so that total sits at
 * the top of the screen rather than being something a reader has to add up from
 * the rows — and it is filtered by exactly the same query the list below it
 * uses, so the two can never disagree.
 */
export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.COMMERCIAL_MANAGE)
  if (!viewer) return <AccessDenied what="quotations" />

  const { status, q } = await searchParams
  const search = q?.trim() ?? ''

  const statusFilter = QUOTATION_STATUSES.includes(status as QuotationStatus)
    ? (status as QuotationStatus)
    : null

  const where = {
    ...(await leadChildVisibilityFilter(viewer)),
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(search
      ? {
          OR: [
            { quoteNumber: { contains: search, mode: 'insensitive' as const } },
            {
              lead: {
                leadCode: { contains: search, mode: 'insensitive' as const },
              },
            },
            {
              lead: {
                client: {
                  companyName: {
                    contains: search,
                    mode: 'insensitive' as const,
                  },
                },
              },
            },
          ],
        }
      : {}),
  }

  const [quotations, total, accepted, symbol] = await Promise.all([
    prisma.quotation.findMany({
      where,
      select: {
        id: true,
        quoteNumber: true,
        quoteDate: true,
        validUntil: true,
        status: true,
        totalAmount: true,
        lead: {
          select: {
            id: true,
            leadCode: true,
            client: { select: { id: true, companyName: true } },
            assignedTo: { select: { name: true } },
          },
        },
        _count: { select: { items: true, invoices: true } },
      },
      orderBy: { quoteDate: 'desc' },
      take: PAGE_SIZE,
    }),
    prisma.quotation.count({ where }),
    prisma.quotation.aggregate({
      where: { ...where, status: 'ACCEPTED' },
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
    currencySymbol(),
  ])

  return (
    <div className="space-y-5">
      <PageHeader
        title="Quotations"
        description="Priced offers to clients. Each total is the sum of its lines — the header is never typed."
        actions={
          <ButtonLink href="/quotations/new" size="sm">
            New quotation
          </ButtonLink>
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
            placeholder="Quote number, lead code or client"
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
            {QUOTATION_STATUSES.map((value) => (
              <option key={value} value={value}>
                {QUOTATION_STATUS_LABELS[value]}
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
        <ButtonLink href="/quotations" variant="ghost">
          Clear
        </ButtonLink>
      </form>

      <StatRow>
        <Stat label="Quotations" value={String(total)} />
        <Stat label="Accepted" value={String(accepted._count._all)} />
        <Stat
          label="Order value"
          value={formatMoney(accepted._sum.totalAmount, symbol)}
          hint="Accepted quotations only (docs/02 §4.6)"
        />
      </StatRow>

      {quotations.length === 0 ? (
        <EmptyState>
          No quotations match. Clear the filters, or raise the first one.
        </EmptyState>
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Quote</TH>
                <TH>Client</TH>
                <TH>Owner</TH>
                <TH>Raised</TH>
                <TH>Valid until</TH>
                <TH className="text-right">Lines</TH>
                <TH className="text-right">Total</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {quotations.map((quotation) => (
                <TR key={quotation.id}>
                  <TD>
                    <a
                      href={`/quotations/${quotation.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {quotation.quoteNumber}
                    </a>
                    <div className="text-xs text-slate-500">
                      <a
                        href={`/leads/${quotation.lead.id}`}
                        className="hover:underline"
                      >
                        {quotation.lead.leadCode}
                      </a>
                      {quotation._count.invoices > 0
                        ? ` · ${quotation._count.invoices} invoice${quotation._count.invoices === 1 ? '' : 's'}`
                        : ''}
                    </div>
                  </TD>
                  <TD>
                    <a
                      href={`/clients/${quotation.lead.client.id}`}
                      className="text-slate-700 hover:underline"
                    >
                      {quotation.lead.client.companyName}
                    </a>
                  </TD>
                  <TD className="text-slate-600">
                    {quotation.lead.assignedTo?.name ?? 'Unassigned'}
                  </TD>
                  <TD className="text-slate-600">
                    {formatDate(quotation.quoteDate)}
                  </TD>
                  <TD className="text-slate-600">
                    {formatDate(quotation.validUntil)}
                  </TD>
                  <TD className="text-right tabular-nums text-slate-600">
                    {quotation._count.items}
                  </TD>
                  <TD className="text-right font-medium text-slate-900">
                    {formatMoney(quotation.totalAmount, symbol)}
                  </TD>
                  <TD>
                    <Badge tone={QUOTATION_STATUS_TONES[quotation.status]}>
                      {QUOTATION_STATUS_LABELS[quotation.status]}
                    </Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>

          <p className="text-xs text-slate-500">
            Showing {quotations.length} of {total} quotations
            {total > PAGE_SIZE ? ' — narrow the filters to see the rest' : ''}.
          </p>
        </>
      )}
    </div>
  )
}
