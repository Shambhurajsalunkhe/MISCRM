import { prisma } from '@/lib/db'
import { can } from '@/lib/authz'
import { requireUser } from '@/lib/auth/session'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { formatDate, formatMoney } from '@/lib/format'
import {
  BILLING_CYCLE_LABELS,
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUS_TONES,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
} from '@/lib/commercials/display'
import { displayStatus } from '@/lib/commercials/overdue'
import { leadMoney } from '@/lib/commercials/revenue'
import { Badge } from '@/components/ui/badge'
import { ButtonLink } from '@/components/ui/button'
import { Card, EmptyState } from '@/components/ui/page'
import { Stat, StatRow } from '@/components/ui/stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { loadLead } from '../lead'

type Params = Promise<{ id: string }>

export const metadata = { title: 'Commercials · Sales CRM' }

/**
 * Contracts, invoices and the money on one deal (docs/03 §1).
 *
 * The four figures at the top are docs/02 §5 applied to a single lead, and the
 * fifth — what is won but not yet invoiced — is the reason they are worth
 * showing together. Q11 turned invoicing on for every vertical precisely so that
 * `Collected + Pending` reconciles to Won Revenue; where it does not, the gap is
 * a real one, and naming it here is more useful than letting the dashboard show
 * a company-wide difference nobody can attribute.
 */
export default async function LeadCommercialsPage({
  params,
}: {
  params: Params
}) {
  const viewer = await requireUser()
  const { id } = await params
  const lead = await loadLead(viewer, id)

  const canManage = await can(viewer, PERMISSIONS.COMMERCIAL_MANAGE)

  if (!canManage) {
    return (
      <Card title="Commercials">
        <EmptyState>
          Contracts, quotations and invoices are outside your permissions. Ask
          whoever owns this deal for the figures.
        </EmptyState>
      </Card>
    )
  }

  if (!lead.vertical.usesContracts && !lead.vertical.usesInvoicing) {
    return (
      <Card title="Commercials">
        <EmptyState>
          {lead.vertical.name} has both contracts and invoicing switched off.
          Both are switches on the vertical in Master Data — invoicing is on
          everywhere by default (Q11), so this vertical has had it turned off
          deliberately.
        </EmptyState>
      </Card>
    )
  }

  const [contracts, invoices, money, symbol] = await Promise.all([
    lead.vertical.usesContracts
      ? prisma.contract.findMany({
          where: { leadId: lead.id },
          select: {
            id: true,
            contractNumber: true,
            contractValue: true,
            billingCycle: true,
            startDate: true,
            endDate: true,
            status: true,
            _count: { select: { invoices: true } },
          },
          orderBy: { createdAt: 'desc' },
        })
      : Promise.resolve([]),
    prisma.invoice.findMany({
      where: { leadId: lead.id },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        dueDate: true,
        totalAmount: true,
        amountReceived: true,
        amountPending: true,
        status: true,
      },
      orderBy: [{ dueDate: 'asc' }, { invoiceDate: 'desc' }],
    }),
    leadMoney({
      id: lead.id,
      status: lead.status,
      dealValue: lead.dealValue,
      vertical: { usesRequirements: lead.vertical.usesRequirements },
    }),
    currencySymbol(),
  ])

  const now = new Date()

  return (
    <div className="space-y-5">
      <StatRow>
        <Stat
          label="Won revenue"
          value={formatMoney(money.won, symbol)}
          hint={
            lead.vertical.usesRequirements
              ? 'Sum of placements on this lead (decision D8)'
              : lead.status === 'WON'
                ? 'The agreed deal value'
                : 'Counts once the lead is won'
          }
        />
        <Stat
          label="Invoiced"
          value={formatMoney(money.invoiced, symbol)}
          hint={`${money.invoiceCount} live invoice${money.invoiceCount === 1 ? '' : 's'}`}
        />
        <Stat label="Collected" value={formatMoney(money.collected, symbol)} />
        <Stat
          label="Pending"
          value={formatMoney(money.pending, symbol)}
          hint={
            money.uninvoiced > 0
              ? `${formatMoney(money.uninvoiced, symbol)} won but not yet invoiced`
              : 'Collected + Pending reconciles to Won'
          }
        />
      </StatRow>

      {lead.vertical.usesContracts ? (
        <Card
          title="Contracts"
          description="What the client signed up to, and how often it bills."
          actions={
            <ButtonLink href={`/contracts/new?lead=${lead.id}`} size="sm">
              New contract
            </ButtonLink>
          }
        >
          {contracts.length === 0 ? (
            <EmptyState>No contracts on this deal yet.</EmptyState>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Contract</TH>
                  <TH>Term</TH>
                  <TH>Billing</TH>
                  <TH className="text-right">Value</TH>
                  <TH className="text-right">Invoices</TH>
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
                    <TD className="text-right tabular-nums text-slate-600">
                      {contract._count.invoices}
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
          )}
        </Card>
      ) : null}

      <Card
        title="Invoices"
        description="Raised against this deal, whether from a contract, an accepted quotation, a placement or the deal itself."
        actions={
          lead.vertical.usesInvoicing ? (
            <ButtonLink href={`/invoices/new?lead=${lead.id}`} size="sm">
              New invoice
            </ButtonLink>
          ) : null
        }
      >
        {invoices.length === 0 ? (
          <EmptyState>
            Nothing invoiced yet.
            {money.won > 0
              ? ` ${formatMoney(money.won, symbol)} has been won on this deal with no invoice behind it.`
              : ''}
          </EmptyState>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Invoice</TH>
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
                    </TD>
                    <TD className="text-slate-600">
                      {formatDate(invoice.invoiceDate)}
                    </TD>
                    <TD className="text-slate-600">
                      {formatDate(invoice.dueDate)}
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
        )}
      </Card>
    </div>
  )
}
