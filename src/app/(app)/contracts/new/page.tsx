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
import { ContractForm } from '../contract-form'

export const metadata = { title: 'New contract · Sales CRM' }

type SearchParams = Promise<{ lead?: string }>

export default async function NewContractPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.COMMERCIAL_MANAGE)
  if (!viewer) return <AccessDenied what="contracts" />

  const { lead } = await searchParams

  const lockedLead = await lockedLeadOption(viewer, lead, 'usesContracts')
  const leads = lockedLead
    ? []
    : await commercialLeadOptions(viewer, 'usesContracts')
  const symbol = await currencySymbol()

  return (
    <div className="space-y-5">
      <PageHeader
        title="New contract"
        description="What the client signed up to, and how often it bills. Invoices are raised against it afterwards — a contract is a record, not a stage (decision D10)."
      />

      {!lockedLead && leads.length === 0 ? (
        <EmptyState>
          There are no leads you can raise a contract against yet. Contracts are
          a module switch on the vertical in Master Data.
        </EmptyState>
      ) : (
        <ContractForm
          mode="create"
          leads={leads}
          lockedLead={lockedLead ?? undefined}
          truncated={leads.length === LEAD_PICKER_LIMIT}
          currencySymbol={symbol}
          cancelHref={
            lockedLead ? `/leads/${lockedLead.id}/commercials` : '/contracts'
          }
        />
      )}
    </div>
  )
}
