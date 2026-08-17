import { prisma } from '@/lib/db'
import { can } from '@/lib/authz'
import { requireUser } from '@/lib/auth/session'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { formatDate, formatMoney } from '@/lib/format'
import {
  QUOTATION_STATUS_LABELS,
  QUOTATION_STATUS_TONES,
} from '@/lib/commercials/display'
import { Badge } from '@/components/ui/badge'
import { ButtonLink } from '@/components/ui/button'
import { Card, EmptyState } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { loadLead } from '../lead'

type Params = Promise<{ id: string }>

export const metadata = { title: 'Quotations · Sales CRM' }

/**
 * Quotations under one lead (docs/03 §1).
 *
 * A Product Sales deal can carry several: a first quote, a revised one after
 * negotiation, and whatever was actually accepted. They are separate documents
 * rather than versions of one, because each was sent and each is what the
 * client was looking at on a given day — and only the accepted one counts
 * towards Order Value.
 */
export default async function LeadQuotationsPage({
  params,
}: {
  params: Params
}) {
  const viewer = await requireUser()
  const { id } = await params
  const lead = await loadLead(viewer, id)

  if (!lead.vertical.usesQuotations) {
    return (
      <Card title="Quotations">
        <EmptyState>
          {lead.vertical.name} leads do not use quotations. The module is a
          switch on the vertical in Master Data, so this tab appears wherever it
          is turned on.
        </EmptyState>
      </Card>
    )
  }

  const canManage = await can(viewer, PERMISSIONS.COMMERCIAL_MANAGE)

  if (!canManage) {
    return (
      <Card title="Quotations">
        <EmptyState>
          Quotations, contracts and invoices are outside your permissions. Ask
          whoever owns this deal for the figures.
        </EmptyState>
      </Card>
    )
  }

  const [quotations, symbol] = await Promise.all([
    prisma.quotation.findMany({
      where: { leadId: lead.id },
      select: {
        id: true,
        quoteNumber: true,
        quoteDate: true,
        validUntil: true,
        status: true,
        totalAmount: true,
        _count: { select: { items: true, invoices: true } },
      },
      orderBy: { quoteDate: 'desc' },
    }),
    currencySymbol(),
  ])

  return (
    <Card
      title="Quotations"
      description="Priced offers on this deal. Only an accepted quotation counts towards Order Value."
      actions={
        <ButtonLink href={`/quotations/new?lead=${lead.id}`} size="sm">
          New quotation
        </ButtonLink>
      }
    >
      {quotations.length === 0 ? (
        <EmptyState>
          No quotations yet. Raise the first one from the button above.
        </EmptyState>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Quote</TH>
              <TH>Raised</TH>
              <TH>Valid until</TH>
              <TH className="text-right">Lines</TH>
              <TH className="text-right">Total</TH>
              <TH className="text-right">Invoices</TH>
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
                <TD className="text-right tabular-nums text-slate-600">
                  {quotation._count.invoices}
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
      )}
    </Card>
  )
}
