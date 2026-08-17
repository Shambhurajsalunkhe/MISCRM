import { prisma } from '@/lib/db'
import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { leadChildVisibilityFilter } from '@/lib/visibility'
import { formatDate, formatMoney } from '@/lib/format'
import { fromCents, sumCents } from '@/lib/commercials/money'
import {
  BILLING_CYCLE_LABELS,
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUS_TONES,
  CONTRACT_STATUSES,
} from '@/lib/commercials/display'
import { AccessDenied } from '@/components/access-denied'
import { Badge } from '@/components/ui/badge'
import { ButtonLink } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/field'
import { EmptyState, PageHeader } from '@/components/ui/page'
import { Stat, StatRow } from '@/components/ui/stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import type { ContractStatus } from '@/generated/prisma/enums'

export const metadata = { title: 'Contracts · Sales CRM' }

type SearchParams = Promise<{ status?: string; q?: string }>

const PAGE_SIZE = 100

/**
 * The contract register (docs/03 §1).
 *
 * Contract value and invoiced value are shown side by side rather than one
 * being derived from the other. They answer different questions — what was
 * agreed, and what has actually been billed — and a retainer three months into
 * a twelve-month term is *supposed* to show a quarter billed. Collapsing them
 * into one column is how a healthy contract starts looking like a shortfall.
 */
export default async function ContractsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.COMMERCIAL_MANAGE)
  if (!viewer) return <AccessDenied what="contracts" />

  const { status, q } = await searchParams
  const search = q?.trim() ?? ''

  const statusFilter = CONTRACT_STATUSES.includes(status as ContractStatus)
    ? (status as ContractStatus)
    : null

  const where = {
    ...(await leadChildVisibilityFilter(viewer)),
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(search
      ? {
          OR: [
            {
              contractNumber: {
                contains: search,
                mode: 'insensitive' as const,
              },
            },
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

  const [contracts, total, live, symbol] = await Promise.all([
    prisma.contract.findMany({
      where,
      select: {
        id: true,
        contractNumber: true,
        contractValue: true,
        billingCycle: true,
        startDate: true,
        endDate: true,
        status: true,
        lead: {
          select: {
            id: true,
            leadCode: true,
            client: { select: { id: true, companyName: true } },
            assignedTo: { select: { name: true } },
          },
        },
        invoices: {
          where: { status: { not: 'CANCELLED' } },
          select: { totalAmount: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
    }),
    prisma.contract.count({ where }),
    prisma.contract.aggregate({
      where: { ...where, status: { in: ['SIGNED', 'ACTIVE'] } },
      _count: { _all: true },
      _sum: { contractValue: true },
    }),
    currencySymbol(),
  ])

  return (
    <div className="space-y-5">
      <PageHeader
        title="Contracts"
        description="Signed engagements and what they bill. Raising an invoice against one is how the money follows."
        actions={
          <ButtonLink href="/contracts/new" size="sm">
            New contract
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
            placeholder="Contract number, lead code or client"
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
            {CONTRACT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {CONTRACT_STATUS_LABELS[value]}
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
        <ButtonLink href="/contracts" variant="ghost">
          Clear
        </ButtonLink>
      </form>

      <StatRow>
        <Stat label="Contracts" value={String(total)} />
        <Stat label="Signed or active" value={String(live._count._all)} />
        <Stat
          label="Contracted value"
          value={formatMoney(live._sum.contractValue, symbol)}
          hint="Signed and active contracts only"
        />
      </StatRow>

      {contracts.length === 0 ? (
        <EmptyState>
          No contracts match. Clear the filters, or raise the first one.
        </EmptyState>
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Contract</TH>
                <TH>Client</TH>
                <TH>Owner</TH>
                <TH>Term</TH>
                <TH>Billing</TH>
                <TH className="text-right">Value</TH>
                <TH className="text-right">Invoiced</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {contracts.map((contract) => (
                <TR key={contract.id}>
                  <TD>
                    <a
                      href={`/contracts/${contract.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {contract.contractNumber}
                    </a>
                    <div className="text-xs text-slate-500">
                      <a
                        href={`/leads/${contract.lead.id}`}
                        className="hover:underline"
                      >
                        {contract.lead.leadCode}
                      </a>
                    </div>
                  </TD>
                  <TD>
                    <a
                      href={`/clients/${contract.lead.client.id}`}
                      className="text-slate-700 hover:underline"
                    >
                      {contract.lead.client.companyName}
                    </a>
                  </TD>
                  <TD className="text-slate-600">
                    {contract.lead.assignedTo?.name ?? 'Unassigned'}
                  </TD>
                  <TD className="text-slate-600">
                    {formatDate(contract.startDate)} →{' '}
                    {formatDate(contract.endDate)}
                  </TD>
                  <TD className="text-slate-600">
                    {BILLING_CYCLE_LABELS[contract.billingCycle]}
                  </TD>
                  <TD className="text-right font-medium text-slate-900">
                    {formatMoney(contract.contractValue, symbol)}
                  </TD>
                  <TD className="text-right text-slate-600">
                    {formatMoney(
                      fromCents(
                        sumCents(
                          contract.invoices.map((invoice) => invoice.totalAmount),
                        ),
                      ),
                      symbol,
                    )}
                  </TD>
                  <TD>
                    <Badge tone={CONTRACT_STATUS_TONES[contract.status]}>
                      {CONTRACT_STATUS_LABELS[contract.status]}
                    </Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>

          <p className="text-xs text-slate-500">
            Showing {contracts.length} of {total} contracts
            {total > PAGE_SIZE ? ' — narrow the filters to see the rest' : ''}.
          </p>
        </>
      )}
    </div>
  )
}
