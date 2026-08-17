import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import {
  commercialLeadOptions,
  invoiceSourceOptions,
  LEAD_PICKER_LIMIT,
  lockedLeadOption,
} from '@/lib/commercials/options'
import { AccessDenied } from '@/components/access-denied'
import { EmptyState, PageHeader } from '@/components/ui/page'
import { InvoiceForm } from './invoice-form'

export const metadata = { title: 'New invoice · Sales CRM' }

type SearchParams = Promise<{
  lead?: string
  contract?: string
  quotation?: string
  placement?: string
}>

/**
 * Raise an invoice.
 *
 * The "bills for" picker only appears once a lead is fixed, because the answers
 * come from that lead. Arriving with `?lead=` — from the lead's Commercials tab,
 * a contract, a quotation or a placement — is therefore the fuller route, and
 * the extra query parameters pre-select the record the user was looking at.
 * Starting from the register with no lead in hand raises an invoice against the
 * deal itself, which is all five of the verticals Q11 brought in ever need.
 */
export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.COMMERCIAL_MANAGE)
  if (!viewer) return <AccessDenied what="invoices" />

  const { lead, contract, quotation, placement } = await searchParams

  const lockedLead = await lockedLeadOption(viewer, lead, 'usesInvoicing')
  const [leads, sources, symbol] = await Promise.all([
    lockedLead ? Promise.resolve([]) : commercialLeadOptions(viewer, 'usesInvoicing'),
    lockedLead ? invoiceSourceOptions(lockedLead.id) : Promise.resolve([]),
    currencySymbol(),
  ])

  // Re-validated by `raiseInvoice` against the lead regardless — these ids come
  // from a URL, so they only ever pre-select something the list already offers.
  const defaultSource = contract
    ? `contract:${contract}`
    : quotation
      ? `quotation:${quotation}`
      : placement
        ? `placement:${placement}`
        : undefined

  return (
    <div className="space-y-5">
      <PageHeader
        title="New invoice"
        description="What the client owes and when. Collected and Pending Revenue are read from these rows and the receipts against them."
      />

      {!lockedLead && leads.length === 0 ? (
        <EmptyState>
          There are no leads you can invoice yet. Invoicing is a module switch on
          the vertical in Master Data — it is on for every vertical by default
          (Q11), so this usually means there are no leads in your scope.
        </EmptyState>
      ) : (
        <InvoiceForm
          leads={leads}
          lockedLead={lockedLead ?? undefined}
          truncated={leads.length === LEAD_PICKER_LIMIT}
          sources={sources}
          defaultSource={defaultSource}
          currencySymbol={symbol}
          cancelHref={
            lockedLead ? `/leads/${lockedLead.id}/commercials` : '/invoices'
          }
        />
      )}
    </div>
  )
}
