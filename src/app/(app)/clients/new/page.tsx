import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { AccessDenied } from '@/components/access-denied'
import { PageHeader } from '@/components/ui/page'
import { ClientForm } from '../client-form'
import { loadClientFormOptions } from '../options'

export const metadata = { title: 'Add client · Sales CRM' }

export default async function NewClientPage() {
  const viewer = await pageAccess(PERMISSIONS.LEAD_EDIT)
  if (!viewer) return <AccessDenied what="client records" />

  const { countries, owners } = await loadClientFormOptions()

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="Add client"
        description="A client code is issued on save. If the company already exists you will be shown the match before anything is created."
      />
      <ClientForm countries={countries} owners={owners} />
    </div>
  )
}
