import { notFound } from 'next/navigation'

import { prisma } from '@/lib/db'
import { can, pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { leadChildVisibilityFilter } from '@/lib/visibility'
import { formatDate, formatMoney, toDateInputValue } from '@/lib/format'
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  PAYMENT_MODE_LABELS,
} from '@/lib/commercials/display'
import { toCents } from '@/lib/commercials/money'
import { daysOverdue, displayStatus } from '@/lib/commercials/overdue'
import { AccessDenied } from '@/components/access-denied'
import { Badge } from '@/components/ui/badge'
import { Card, EmptyState } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { RowAction } from '@/components/row-action'
import { DocumentTable } from '@/components/documents/document-table'
import { UploadForm } from '@/components/documents/upload-form'
import { deletePaymentAction, setInvoiceCancelledAction } from '../actions'
import { AmendInvoiceForm } from './amend-form'
import { PaymentForm } from './payment-form'

type Params = Promise<{ id: string }>

export const metadata = { title: 'Invoice · Sales CRM' }

/**
 * One invoice and its receipts (docs/03 §1).
 *
 * `amountReceived` and `amountPending` are columns, not sums computed here —
 * they are maintained on every payment write so the dashboard never has to
 * aggregate `Payment` at read time (docs/01 §3). The receipts are listed below
 * them anyway, because a client querying a statement asks *which* payments, and
 * because a column that disagrees with the rows under it is the one bug in this
 * area worth being able to see at a glance.
 */
export default async function InvoicePage({ params }: { params: Params }) {
  const viewer = await pageAccess(PERMISSIONS.COMMERCIAL_MANAGE)
  if (!viewer) return <AccessDenied what="invoices" />

  const { id } = await params

  const invoice = await prisma.invoice.findFirst({
    where: { id, ...(await leadChildVisibilityFilter(viewer)) },
    select: {
      id: true,
      invoiceNumber: true,
      invoiceDate: true,
      dueDate: true,
      amount: true,
      taxAmount: true,
      totalAmount: true,
      amountReceived: true,
      amountPending: true,
      status: true,
      notes: true,
      leadId: true,
      client: { select: { id: true, clientName: true } },
      lead: {
        select: {
          id: true,
          leadCode: true,
          title: true,
          assignedTo: { select: { name: true } },
          vertical: { select: { name: true } },
        },
      },
      contract: { select: { id: true, contractNumber: true } },
      quotation: { select: { id: true, quoteNumber: true } },
      placement: {
        select: {
          id: true,
          reversedAt: true,
          candidate: { select: { fullName: true } },
          requirement: { select: { id: true, requirementCode: true } },
        },
      },
      payments: {
        select: {
          id: true,
          amount: true,
          paymentDate: true,
          mode: true,
          referenceNumber: true,
          notes: true,
          recordedBy: { select: { name: true } },
        },
        orderBy: { paymentDate: 'asc' },
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

  if (!invoice) notFound()

  const [symbol, canRecordPayment, canAttach] = await Promise.all([
    currencySymbol(),
    can(viewer, PERMISSIONS.COMMERCIAL_PAYMENT),
    can(viewer, PERMISSIONS.ACTIVITY_MANAGE),
  ])

  const now = new Date()
  const shown = displayStatus(invoice, now)
  const late = shown === 'OVERDUE' ? daysOverdue(invoice.dueDate, now) : 0
  const cancelled = invoice.status === 'CANCELLED'
  const settled = toCents(invoice.amountPending) <= 0

  return (
    <div className="space-y-5">
      <header className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-900">
                {invoice.invoiceNumber}
              </h1>
              <Badge tone={INVOICE_STATUS_TONES[shown]}>
                {INVOICE_STATUS_LABELS[shown]}
              </Badge>
              <Badge tone="info">{invoice.lead.vertical.name}</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-700">{invoice.lead.title}</p>
            <p className="mt-0.5 text-sm text-slate-500">
              <a
                href={`/clients/${invoice.client.id}`}
                className="hover:underline"
              >
                {invoice.client.clientName}
              </a>
              {' · '}
              <a href={`/leads/${invoice.lead.id}`} className="hover:underline">
                {invoice.lead.leadCode}
              </a>
              {invoice.lead.assignedTo
                ? ` · ${invoice.lead.assignedTo.name}`
                : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <AmendInvoiceForm
              invoiceId={invoice.id}
              invoiceDate={toDateInputValue(invoice.invoiceDate)}
              dueDate={toDateInputValue(invoice.dueDate)}
              amount={invoice.amount.toString()}
              taxAmount={invoice.taxAmount.toString()}
              notes={invoice.notes}
              amountsLocked={toCents(invoice.amountReceived) > 0}
              currencySymbol={symbol}
            />
            <RowAction
              action={setInvoiceCancelledAction}
              id={invoice.id}
              hidden={{ cancelled: cancelled ? 'false' : 'true' }}
              label={cancelled ? 'Reinstate' : 'Cancel invoice'}
              confirmMessage={
                cancelled
                  ? `Put ${invoice.invoiceNumber} back into the ledger? Its status is re-derived from the due date and any receipts.`
                  : `Cancel ${invoice.invoiceNumber}? It stays in the register and stops counting towards Pending Revenue.`
              }
            />
          </div>
        </div>

        <dl className="grid gap-3 border-t border-slate-100 pt-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Fact
            label="Total"
            value={formatMoney(invoice.totalAmount, symbol)}
            hint={`${formatMoney(invoice.amount, symbol)} + ${formatMoney(invoice.taxAmount, symbol)} tax`}
          />
          <Fact
            label="Received"
            value={formatMoney(invoice.amountReceived, symbol)}
            hint={`${invoice.payments.length} receipt${invoice.payments.length === 1 ? '' : 's'}`}
          />
          <Fact
            label="Outstanding"
            value={formatMoney(invoice.amountPending, symbol)}
            hint={cancelled ? 'Cancelled — outside Pending Revenue' : undefined}
          />
          <Fact
            label="Due"
            value={formatDate(invoice.dueDate)}
            hint={
              late > 0
                ? `${late} day${late === 1 ? '' : 's'} late`
                : `Raised ${formatDate(invoice.invoiceDate)}`
            }
          />
        </dl>

        <p className="border-t border-slate-100 pt-3 text-sm text-slate-600">
          <span className="text-xs uppercase tracking-wide text-slate-500">
            Bills for{' '}
          </span>
          {invoice.contract ? (
            <a
              href={`/contracts/${invoice.contract.id}`}
              className="font-medium text-slate-900 hover:underline"
            >
              Contract {invoice.contract.contractNumber}
            </a>
          ) : invoice.quotation ? (
            <a
              href={`/quotations/${invoice.quotation.id}`}
              className="font-medium text-slate-900 hover:underline"
            >
              Quotation {invoice.quotation.quoteNumber}
            </a>
          ) : invoice.placement ? (
            <a
              href={`/requirements/${invoice.placement.requirement.id}`}
              className="font-medium text-slate-900 hover:underline"
            >
              {invoice.placement.candidate.fullName} on{' '}
              {invoice.placement.requirement.requirementCode}
              {invoice.placement.reversedAt ? ' — placement reversed' : ''}
            </a>
          ) : (
            <span className="text-slate-700">
              the deal itself — no contract, quotation or placement behind it
            </span>
          )}
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-5">
          <Card
            title="Receipts"
            description="Collected Revenue is the sum of these rows across the company (docs/02 §5)."
          >
            {invoice.payments.length === 0 ? (
              <EmptyState>Nothing received yet.</EmptyState>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Received</TH>
                    <TH className="text-right">Amount</TH>
                    <TH>Method</TH>
                    <TH>Reference</TH>
                    <TH>Recorded by</TH>
                    {canRecordPayment ? (
                      <TH>
                        <span className="sr-only">Actions</span>
                      </TH>
                    ) : null}
                  </TR>
                </THead>
                <TBody>
                  {invoice.payments.map((payment) => (
                    <TR key={payment.id}>
                      <TD className="text-slate-600">
                        {formatDate(payment.paymentDate)}
                      </TD>
                      <TD className="text-right font-medium text-slate-900">
                        {formatMoney(payment.amount, symbol)}
                      </TD>
                      <TD className="text-slate-600">
                        {PAYMENT_MODE_LABELS[payment.mode]}
                      </TD>
                      <TD className="text-slate-600">
                        {payment.referenceNumber ?? '—'}
                        {payment.notes ? (
                          <div className="text-xs text-slate-500">
                            {payment.notes}
                          </div>
                        ) : null}
                      </TD>
                      <TD className="text-slate-600">
                        {payment.recordedBy.name}
                      </TD>
                      {canRecordPayment ? (
                        <TD>
                          <RowAction
                            action={deletePaymentAction}
                            id={payment.id}
                            label="Remove"
                            confirmMessage="Remove this receipt? Only do this if it was keyed in error — the invoice is recomputed from what is left."
                          />
                        </TD>
                      ) : null}
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          <Card
            title="Documents"
            description="The invoice as it was sent, and anything supporting it."
            actions={
              canAttach ? (
                <UploadForm
                  parent={{ kind: 'invoice', id: invoice.id }}
                  defaultDocType="INVOICE"
                />
              ) : null
            }
          >
            <DocumentTable documents={invoice.documents} canManage={canAttach} />
          </Card>
        </div>

        <div className="space-y-5">
          <Card
            title="Record a payment"
            description={
              cancelled
                ? 'This invoice is cancelled. Reinstate it before recording a receipt.'
                : settled
                  ? 'Nothing outstanding.'
                  : 'The outstanding amount is filled in — change it for a part payment.'
            }
          >
            {!canRecordPayment ? (
              <EmptyState>
                Recording payments is a separate permission from raising
                invoices. Ask whoever handles collections.
              </EmptyState>
            ) : cancelled || settled ? (
              <EmptyState>
                {cancelled
                  ? 'Cancelled invoices do not take receipts.'
                  : `${invoice.invoiceNumber} is paid in full.`}
              </EmptyState>
            ) : (
              <PaymentForm
                invoiceId={invoice.id}
                outstanding={invoice.amountPending.toString()}
                currencySymbol={symbol}
              />
            )}
          </Card>

          {invoice.notes ? (
            <Card title="Notes">
              <p className="text-sm whitespace-pre-line text-slate-700">
                {invoice.notes}
              </p>
            </Card>
          ) : null}
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
