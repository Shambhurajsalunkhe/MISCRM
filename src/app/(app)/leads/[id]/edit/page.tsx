import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { can } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { leadFormLayout } from '@/lib/leads/vertical-form'
import { AccessDenied } from '@/components/access-denied'
import { PageHeader } from '@/components/ui/page'
import { loadLead } from '../lead'
import { LeadEditForm } from './edit-form'

type Params = Promise<{ id: string }>

export const metadata = { title: 'Edit lead · Sales CRM' }

export default async function EditLeadPage({ params }: { params: Params }) {
  const viewer = await requireUser()
  if (!(await can(viewer, PERMISSIONS.LEAD_EDIT))) {
    return <AccessDenied what="lead editing" />
  }

  const { id } = await params
  const lead = await loadLead(viewer, id)

  const [contacts, sources, products, symbol, canSetDealValue] =
    await Promise.all([
      prisma.clientContact.findMany({
        where: { clientId: lead.client.id, isActive: true },
        orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
        select: { id: true, name: true, designation: true },
      }),
      prisma.leadSource.findMany({
        where: {
          isActive: true,
          OR: [{ verticalId: null }, { verticalId: lead.vertical.id }],
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.product.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      currencySymbol(),
      can(viewer, PERMISSIONS.LEAD_COMMERCIAL),
    ])

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title={`Edit ${lead.leadCode}`}
        description="Stage and assignment are changed from the lead header, where each writes its own history entry."
      />

      <LeadEditForm
        lead={{
          id: lead.id,
          title: lead.title,
          requirementDescription: lead.requirementDescription,
          sourceId: lead.sourceId,
          productId: lead.productId,
          primaryContactId: lead.primaryContactId,
          expectedBudget: lead.expectedBudget?.toString() ?? null,
          dealValue: lead.dealValue?.toString() ?? null,
          expectedTimeline: lead.expectedTimeline,
          priority: lead.priority,
          additionalNotes: lead.additionalNotes,
          campaignName: lead.campaignName,
          referenceUrl: lead.referenceUrl,
          expectedCloseDate: lead.expectedCloseDate,
          nextFollowUpAt: lead.nextFollowUpAt,
        }}
        layout={leadFormLayout(lead.vertical)}
        options={{
          contacts: contacts.map((contact) => ({
            id: contact.id,
            label: contact.designation
              ? `${contact.name} — ${contact.designation}`
              : contact.name,
          })),
          sources,
          products,
        }}
        currencySymbol={symbol}
        canSetDealValue={canSetDealValue}
      />
    </div>
  )
}
