import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { AccessDenied } from '@/components/access-denied'
import { Card, PageHeader } from '@/components/ui/page'
import { createUserAction } from '../actions'
import { loadUserFormOptions } from '../options'
import { UserForm } from '../user-form'

export const metadata = { title: 'Add user · Sales CRM' }

export default async function NewUserPage() {
  const viewer = await pageAccess(PERMISSIONS.ADMIN_USERS)
  if (!viewer) return <AccessDenied what="user administration" />

  const options = await loadUserFormOptions()

  return (
    <div className="space-y-5">
      <PageHeader
        title="Add user"
        description="The role sets what they can do; the reporting manager and team set what they can see."
      />

      <Card className="max-w-3xl">
        <UserForm
          action={createUserAction}
          options={options}
          submitLabel="Create user"
        />
      </Card>
    </div>
  )
}
