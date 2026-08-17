import { prisma } from '@/lib/db'
import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { leadVisibilityFilter } from '@/lib/visibility'
import {
  AccessDenied,
  STAFFING_ACCESS_REASON,
} from '@/components/access-denied'
import { EmptyState, PageHeader } from '@/components/ui/page'
import {
  activeUserOptions,
  LEAD_PICKER_LIMIT,
  requirementLeadOptions,
  requirementTypeOptions,
} from '../options'
import { RequirementForm, type RequirementLeadOption } from '../requirement-form'

export const metadata = { title: 'New requirement · Sales CRM' }

type SearchParams = Promise<{ lead?: string }>

/**
 * Raise a requirement.
 *
 * `?lead=` fixes the parent, which is how the lead's own Requirements tab links
 * here — the picker is then not rendered at all, and the requirement cannot end
 * up under a different account than the one the user was looking at.
 */
export default async function NewRequirementPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.STAFFING_REQUIREMENT_MANAGE)
  if (!viewer)
    return (
      <AccessDenied
        what="staffing requirements"
        reason={STAFFING_ACCESS_REASON}
      />
    )

  const { lead: leadId } = await searchParams

  // Re-checked against the viewer's scope rather than trusted from the query
  // string: the id arrives in a URL anyone can edit.
  const lockedLead = leadId
    ? await prisma.lead.findFirst({
        where: {
          id: leadId,
          isDeleted: false,
          vertical: { usesRequirements: true },
          ...(await leadVisibilityFilter(viewer)),
        },
        select: {
          id: true,
          leadCode: true,
          title: true,
          client: { select: { clientName: true } },
        },
      })
    : null

  const [leads, types, people, symbol] = await Promise.all([
    lockedLead ? Promise.resolve([]) : requirementLeadOptions(viewer),
    requirementTypeOptions(),
    activeUserOptions(),
    currencySymbol(),
  ])

  const options: RequirementLeadOption[] = leads.map((lead) => ({
    id: lead.id,
    leadCode: lead.leadCode,
    title: lead.title,
    clientName: lead.client.clientName,
  }))

  return (
    <div className="space-y-5">
      <PageHeader
        title="New requirement"
        description="A role the client has asked you to fill. Its own stage list and its own outcome live here, not on the lead (decision D8)."
      />

      {!lockedLead && options.length === 0 ? (
        <EmptyState>
          There are no staffing leads you can raise a requirement against yet.
          Create a lead in a vertical whose requirements module is switched on,
          then come back.
        </EmptyState>
      ) : (
        <RequirementForm
          mode="create"
          leads={options}
          lockedLead={
            lockedLead
              ? {
                  id: lockedLead.id,
                  leadCode: lockedLead.leadCode,
                  title: lockedLead.title,
                  clientName: lockedLead.client.clientName,
                }
              : undefined
          }
          leadPickerTruncated={options.length === LEAD_PICKER_LIMIT}
          types={types}
          people={people}
          currencySymbol={symbol}
          cancelHref={lockedLead ? `/leads/${lockedLead.id}/requirements` : '/requirements'}
        />
      )}
    </div>
  )
}
