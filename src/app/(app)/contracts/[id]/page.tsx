import { notFound } from 'next/navigation'

import { prisma } from '@/lib/db'
import { can, pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { leadChildVisibilityFilter } from '@/lib/visibility'
import { formatDate, formatMoney, toDateInputValue } from '@/lib/format'
import {
  BILLING_CYCLE_LABELS,
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUS_TONES,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
} from '@/lib/commercials/display'
import { fromCents, sumCents } from '@/lib/commercials/money'
import { displayStatus } from '@/lib/commercials/overdue'
import { AccessDenied } from '@/components/access-denied'
import { Badge } from '@/components/ui/badge'
import { ButtonLink } from '@/components/ui/button'
import { Card, EmptyState } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { RowAction } from '@/components/row-action'
import { DocumentTable } from '@/components/documents/document-table'
import { UploadForm } from '@/components/documents/upload-form'
import { deleteContractAction } from '../actions'
import { ContractForm } from '../contract-form'
import { ContractStatusControl } from './status-control'

type Params = Promise<{ id: string }>

export const metadata = { title: 'Contract · Sales CRM' }

/**
 * One contract, what has been billed against it, and what is left to bill.
 *
 * "Left to bill" is contract value minus non-cancelled invoices, and it is the
 * number a Digital Marketing account manager actually works from on a monthly
 * retainer: it answers *have I raised this month's invoice yet* without anybody
 * counting rows.
 */
export default async function ContractPage({ params }: { params: Params }) {
  const viewer = await pageAccess(PERMISSIONS.COMMERCIAL_MANAGE)
  if (!viewer) return <AccessDenied what="contracts" />

  const { id } = await params

  const contract = await prisma.contract.findFirst({
    where: { id, ...(await leadChildVisibilityFilter(viewer)) },
    select: {
      id: true,
      contractNumber: true,
      contractValue: true,
      billingCycle: true,
      startDate: true,
      endDate: true,
      signedDate: true,
      status: true,
      notes: true,
      leadId: true,
      lead: {
        select: {
          id: true,
          leadCode: true,
          title: true,
          client: { select: { id: true, clientName: true } },
          assignedTo: { select: { name: true } },
          vertical: { select: { name: true, usesInvoicing: true } },
        },
      },
      invoices: {
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
        orderBy: { invoiceDate: 'asc' },
      },
      documents: {
        select: {
          id: true,
          fileName: true,
          docType: true,
          description: true,
          sizeBytes: true,
          createdAt: true,
          uploadedBy: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  // Same rule as every other detail screen: a record outside this user's scope
  // is indistinguishable from one that does not exist.
  if (!contract) notFound()

  const [symbol, canAttach] = await Promise.all([
    currencySymbol(),
    can(viewer, PERMISSIONS.ACTIVITY_MANAGE),
  ])

  const now = new Date()
  const billedCents = sumCents(
    contract.invoices
      .filter((invoice) => invoice.status !== 'CANCELLED')
      .map((invoice) => invoice.totalAmount),
  )
  const remainingCents = Math.max(
    sumCents([contract.contractValue]) - billedCents,
    0,
  )

  return (
    <div className="space-y-5">
      <header className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-900">
                {contract.contractNumber}
              </h1>
              <Badge tone={CONTRACT_STATUS_TONES[contract.status]}>
                {CONTRACT_STATUS_LABELS[contract.status]}
              </Badge>
              <Badge tone="info">{contract.lead.vertical.name}</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-700">{contract.lead.title}</p>
            <p className="mt-0.5 text-sm text-slate-500">
              <a
                href={`/clients/${contract.lead.client.id}`}
                className="hover:underline"
              >
                {contract.lead.client.clientName}
              </a>
              {' · '}
              <a href={`/leads/${contract.lead.id}`} className="hover:underline">
                {contract.lead.leadCode}
              </a>
              {contract.lead.assignedTo
                ? ` · ${contract.lead.assignedTo.name}`
                : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {contract.lead.vertical.usesInvoicing ? (
              <ButtonLink
                href={`/invoices/new?lead=${contract.lead.id}&contract=${contract.id}`}
                size="sm"
              >
                Raise invoice
              </ButtonLink>
            ) : null}
            {contract.status === 'DRAFT' ? (
              <RowAction
                action={deleteContractAction}
                id={contract.id}
                label="Delete draft"
                confirmMessage={`Delete ${contract.contractNumber}? Only a draft can be deleted.`}
              />
            ) : null}
          </div>
        </div>

        <dl className="grid gap-3 border-t border-slate-100 pt-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Fact
            label="Contract value"
            value={formatMoney(contract.contractValue, symbol)}
            hint={BILLING_CYCLE_LABELS[contract.billingCycle]}
          />
          <Fact
            label="Invoiced"
            value={formatMoney(fromCents(billedCents), symbol)}
            hint={`${contract.invoices.length} invoice${contract.invoices.length === 1 ? '' : 's'}`}
          />
          <Fact
            label="Left to bill"
            value={formatMoney(fromCents(remainingCents), symbol)}
            hint="Contract value less what has been invoiced"
          />
          <Fact
            label="Term"
            value={`${formatDate(contract.startDate)} → ${formatDate(contract.endDate)}`}
            hint={
              contract.signedDate
                ? `Signed ${formatDate(contract.signedDate)}`
                : 'Not signed yet'
            }
          />
        </dl>
      </header>

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-5">
          <Card
            title="Invoices"
            description="Raised against this contract. A monthly retainer produces one of these a month."
          >
            {contract.invoices.length === 0 ? (
              <EmptyState>
                Nothing invoiced yet. Raise the first invoice from the header.
              </EmptyState>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Invoice</TH>
                    <TH>Raised</TH>
                    <TH>Due</TH>
                    <TH className="text-right">Total</TH>
                    <TH className="text-right">Outstanding</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {contract.invoices.map((invoice) => {
                    const shown = displayStatus(invoice, now)
                    return (
                      <TR key={invoice.id}>
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

          <Card
            title="Documents"
            description="The signed agreement and anything attached to it."
            actions={
              canAttach ? (
                <UploadForm
                  parent={{ kind: 'contract', id: contract.id }}
                  defaultDocType="CONTRACT"
                />
              ) : null
            }
          >
            <DocumentTable
              documents={contract.documents}
              canManage={canAttach}
            />
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Status">
            <ContractStatusControl
              contractId={contract.id}
              status={contract.status}
              hasSignedDate={contract.signedDate !== null}
            />
          </Card>

          <Card
            title="Terms"
            description={contract.notes ?? 'No notes on this contract.'}
            actions={
              <ContractForm
                mode="edit"
                defaults={{
                  id: contract.id,
                  contractValue: contract.contractValue.toString(),
                  billingCycle: contract.billingCycle,
                  startDate: toDateInputValue(contract.startDate),
                  endDate: toDateInputValue(contract.endDate),
                  signedDate: toDateInputValue(contract.signedDate),
                  notes: contract.notes,
                }}
                currencySymbol={symbol}
                cancelHref={`/contracts/${contract.id}`}
              />
            }
          >
            <dl className="space-y-2 text-sm">
              <Fact
                label="Billing cycle"
                value={BILLING_CYCLE_LABELS[contract.billingCycle]}
              />
              <Fact label="Starts" value={formatDate(contract.startDate)} />
              <Fact label="Ends" value={formatDate(contract.endDate)} />
              <Fact label="Signed" value={formatDate(contract.signedDate)} />
            </dl>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Fact({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  )
}
