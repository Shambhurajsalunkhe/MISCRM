import { notFound } from 'next/navigation'

import { prisma } from '@/lib/db'
import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { clientVisibilityFilter } from '@/lib/visibility'
import { AccessDenied } from '@/components/access-denied'
import { PageHeader } from '@/components/ui/page'
import { ClientForm } from '../../client-form'
import { loadClientFormOptions } from '../../options'

type Params = Promise<{ id: string }>

export const metadata = { title: 'Edit client · Sales CRM' }

export default async function EditClientPage({ params }: { params: Params }) {
  const viewer = await pageAccess(PERMISSIONS.LEAD_EDIT)
  if (!viewer) return <AccessDenied what="client records" />

  const { id } = await params

  const [client, options] = await Promise.all([
    prisma.client.findFirst({
      where: { id, isDeleted: false, ...(await clientVisibilityFilter(viewer)) },
      select: {
        id: true,
        companyName: true,
        website: true,
        companyLinkedIn: true,
        industry: true,
        countryId: true,
        city: true,
        address: true,
        ownerId: true,
        isActive: true,
      },
    }),
    loadClientFormOptions(),
  ])

  if (!client) notFound()

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title={`Edit ${client.companyName}`}
        description="Contacts are managed on the client page. Renaming a company re-checks it for duplicates."
      />
      <ClientForm
        client={client}
        countries={options.countries}
        owners={options.owners}
      />
    </div>
  )
}
