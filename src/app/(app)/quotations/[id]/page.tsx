import { can, pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { formatDate, formatMoney, toDateInputValue } from '@/lib/format'
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  QUOTATION_STATUS_LABELS,
  QUOTATION_STATUS_TONES,
} from '@/lib/commercials/display'
import { isQuotationEditable } from '@/lib/commercials/quotation'
import { productOptions } from '@/lib/commercials/options'
import { displayStatus } from '@/lib/commercials/overdue'
import { AccessDenied } from '@/components/access-denied'
import { Badge } from '@/components/ui/badge'
import { ButtonLink } from '@/components/ui/button'
import { Card, EmptyState } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { RowAction } from '@/components/row-action'
import { DocumentTable } from '@/components/documents/document-table'
import { UploadForm } from '@/components/documents/upload-form'
import { deleteQuotationAction, deleteQuotationItemAction } from '../actions'
import { loadQuotation } from './quotation'
import { QuotationItemForm } from './item-form'
import { QuotationStatusControl } from './status-control'
import { QuotationTermsForm } from './terms-form'

type Params = Promise<{ id: string }>

export const metadata = { title: 'Quotation · Sales CRM' }

/**
 * One quotation: its lines, its arithmetic and what has been billed against it.
 *
 * The four money rows at the bottom of the lines table are the whole reason
 * this screen exists in this shape. Subtotal is the sum of the lines, discount
 * and tax are typed, and the total is what the client sees — laid out in that
 * order so the number at the end can be checked against the ones above it
 * without anybody re-adding a column.
 */
export default async function QuotationPage({ params }: { params: Params }) {
  const viewer = await pageAccess(PERMISSIONS.COMMERCIAL_MANAGE)
  if (!viewer) return <AccessDenied what="quotations" />

  const { id } = await params
  const quotation = await loadQuotation(viewer, id)

  const [symbol, products, canAttach] = await Promise.all([
    currencySymbol(),
    productOptions(),
    can(viewer, PERMISSIONS.ACTIVITY_MANAGE),
  ])

  const editable = isQuotationEditable(quotation.status)
  const now = new Date()

  return (
    <div className="space-y-5">
      <header className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-900">
                {quotation.quoteNumber}
              </h1>
              <Badge tone={QUOTATION_STATUS_TONES[quotation.status]}>
                {QUOTATION_STATUS_LABELS[quotation.status]}
              </Badge>
              <Badge tone="info">{quotation.lead.vertical.name}</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-700">{quotation.lead.title}</p>
            <p className="mt-0.5 text-sm text-slate-500">
              <a
                href={`/clients/${quotation.lead.client.id}`}
                className="hover:underline"
              >
                {quotation.lead.client.companyName}
              </a>
              {' · '}
              <a
                href={`/leads/${quotation.lead.id}`}
                className="hover:underline"
              >
                {quotation.lead.leadCode}
              </a>
              {quotation.lead.assignedTo
                ? ` · ${quotation.lead.assignedTo.name}`
                : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {quotation.lead.vertical.usesInvoicing &&
            quotation.status === 'ACCEPTED' ? (
              <ButtonLink
                href={`/invoices/new?lead=${quotation.lead.id}&quotation=${quotation.id}`}
                size="sm"
              >
                Raise invoice
              </ButtonLink>
            ) : null}
            {quotation.status === 'DRAFT' ? (
              <RowAction
                action={deleteQuotationAction}
                id={quotation.id}
                label="Delete draft"
                confirmMessage={`Delete ${quotation.quoteNumber}? Only a draft can be deleted — anything sent stays in the record.`}
              />
            ) : null}
          </div>
        </div>

        <dl className="grid gap-3 border-t border-slate-100 pt-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Raised" value={formatDate(quotation.quoteDate)} />
          <Fact
            label="Valid until"
            value={formatDate(quotation.validUntil)}
            hint={
              quotation.validUntil &&
              quotation.validUntil < now &&
              quotation.status !== 'ACCEPTED'
                ? 'Past its validity date'
                : undefined
            }
          />
          <Fact
            label="Total"
            value={formatMoney(quotation.totalAmount, symbol)}
            hint={`${quotation.items.length} line${quotation.items.length === 1 ? '' : 's'}`}
          />
          <Fact
            label="Invoiced"
            value={String(quotation.invoices.length)}
            hint={
              quotation.invoices.length > 0
                ? 'Raised against this quotation'
                : undefined
            }
          />
        </dl>
      </header>

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-5">
          <Card
            title="Lines"
            description={
              editable
                ? 'The total below is computed from these rows and is never typed.'
                : `Fixed — ${quotation.quoteNumber} has been ${QUOTATION_STATUS_LABELS[quotation.status].toLowerCase()}. Raise a new quotation rather than rewriting one the client has already seen.`
            }
          >
            <div className="space-y-3">
              {quotation.items.length === 0 ? (
                <EmptyState>
                  Nothing priced yet. A quotation with no lines cannot be sent or
                  accepted.
                </EmptyState>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Description</TH>
                      <TH className="text-right">Qty</TH>
                      <TH className="text-right">Unit</TH>
                      <TH className="text-right">Line total</TH>
                      {editable ? (
                        <TH>
                          <span className="sr-only">Actions</span>
                        </TH>
                      ) : null}
                    </TR>
                  </THead>
                  <TBody>
                    {quotation.items.map((item) => (
                      <TR key={item.id}>
                        <TD>
                          <div className="font-medium text-slate-900">
                            {item.description}
                          </div>
                          {item.product ? (
                            <div className="text-xs text-slate-500">
                              {item.product.name}
                            </div>
                          ) : null}
                        </TD>
                        <TD className="text-right tabular-nums text-slate-600">
                          {Number(item.quantity.toString())}
                        </TD>
                        <TD className="text-right text-slate-600">
                          {formatMoney(item.unitPrice, symbol)}
                        </TD>
                        <TD className="text-right font-medium text-slate-900">
                          {formatMoney(item.lineTotal, symbol)}
                        </TD>
                        {editable ? (
                          <TD>
                            <RowAction
                              action={deleteQuotationItemAction}
                              id={item.id}
                              label="Remove"
                              confirmMessage="Remove this line? The quotation total is recomputed."
                            />
                          </TD>
                        ) : null}
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}

              <dl className="ml-auto w-full max-w-xs space-y-1 text-sm">
                <MoneyRow
                  label="Subtotal"
                  value={formatMoney(quotation.subtotal, symbol)}
                />
                <MoneyRow
                  label="Discount"
                  value={`− ${formatMoney(quotation.discount, symbol)}`}
                />
                <MoneyRow
                  label="Tax"
                  value={formatMoney(quotation.taxAmount, symbol)}
                />
                <MoneyRow
                  label="Total"
                  value={formatMoney(quotation.totalAmount, symbol)}
                  emphasis
                />
              </dl>

              {editable ? (
                <QuotationItemForm
                  quotationId={quotation.id}
                  products={products}
                  currencySymbol={symbol}
                />
              ) : null}
            </div>
          </Card>

          <Card
            title="Invoices"
            description="Raised against this quotation. Collected and Pending Revenue are read from these rows, not from the quote."
          >
            {quotation.invoices.length === 0 ? (
              <EmptyState>
                Nothing invoiced yet.
                {quotation.status === 'ACCEPTED'
                  ? ' Raise the first invoice from the button in the header.'
                  : ' An invoice can be raised once the client has accepted.'}
              </EmptyState>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Invoice</TH>
                    <TH>Due</TH>
                    <TH className="text-right">Total</TH>
                    <TH className="text-right">Received</TH>
                    <TH className="text-right">Outstanding</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {quotation.invoices.map((invoice) => {
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

          <Card
            title="Documents"
            description="The quotation as it was sent, and anything the client sent back."
            actions={
              canAttach ? (
                <UploadForm
                  parent={{ kind: 'quotation', id: quotation.id }}
                  defaultDocType="QUOTATION"
                />
              ) : null
            }
          >
            <DocumentTable
              documents={quotation.documents}
              canManage={canAttach}
            />
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Status">
            <QuotationStatusControl
              quotationId={quotation.id}
              status={quotation.status}
              leadHasDealValue={quotation.lead.dealValue !== null}
            />
          </Card>

          <Card
            title="Terms"
            description={quotation.notes ?? 'No notes on this quotation.'}
            actions={
              editable ? (
                <QuotationTermsForm
                  quotationId={quotation.id}
                  quoteDate={toDateInputValue(quotation.quoteDate)}
                  validUntil={toDateInputValue(quotation.validUntil)}
                  discount={quotation.discount.toString()}
                  taxAmount={quotation.taxAmount.toString()}
                  notes={quotation.notes}
                  currencySymbol={symbol}
                />
              ) : null
            }
          >
            <dl className="space-y-2 text-sm">
              <Fact label="Quote date" value={formatDate(quotation.quoteDate)} />
              <Fact
                label="Valid until"
                value={formatDate(quotation.validUntil)}
              />
              <Fact
                label="Discount"
                value={formatMoney(quotation.discount, symbol)}
              />
              <Fact label="Tax" value={formatMoney(quotation.taxAmount, symbol)} />
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

function MoneyRow({
  label,
  value,
  emphasis,
}: {
  label: string
  value: string
  emphasis?: boolean
}) {
  return (
    <div
      className={
        emphasis
          ? 'flex justify-between border-t border-slate-200 pt-1 text-base font-semibold text-slate-900'
          : 'flex justify-between text-slate-600'
      }
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}
