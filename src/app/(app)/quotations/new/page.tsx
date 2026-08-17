import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import {
  commercialLeadOptions,
  LEAD_PICKER_LIMIT,
  lockedLeadOption,
} from '@/lib/commercials/options'
import { AccessDenied } from '@/components/access-denied'
import { EmptyState, PageHeader } from '@/components/ui/page'
import { QuotationForm } from './quotation-form'

export const metadata = { title: 'New quotation · Sales CRM' }

type SearchParams = Promise<{ lead?: string }>

export default async function NewQuotationPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.COMMERCIAL_MANAGE)
  if (!viewer) return <AccessDenied what="quotations" />

  const { lead } = await searchParams

  const lockedLead = await lockedLeadOption(viewer, lead, 'usesQuotations')
  const leads = lockedLead
    ? []
    : await commercialLeadOptions(viewer, 'usesQuotations')
  const symbol = await currencySymbol()

  return (
    <div className="space-y-5">
      <PageHeader
        title="New quotation"
        description="A priced offer to a client. Add the lines once it exists — the total is computed from them and never typed."
      />

      {!lockedLead && leads.length === 0 ? (
        <EmptyState>
          There are no leads you can quote against yet. Quotations are a module
          switch on the vertical in Master Data; turn it on there, or create a
          lead in a vertical that already has it.
        </EmptyState>
      ) : (
        <QuotationForm
          leads={leads}
          lockedLead={lockedLead ?? undefined}
          truncated={leads.length === LEAD_PICKER_LIMIT}
          currencySymbol={symbol}
          cancelHref={
            lockedLead ? `/leads/${lockedLead.id}/quotations` : '/quotations'
          }
        />
      )}
    </div>
  )
}
