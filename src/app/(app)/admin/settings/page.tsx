import { prisma } from '@/lib/db'
import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { AccessDenied } from '@/components/access-denied'
import { PageHeader } from '@/components/ui/page'
import { SettingsForm } from './settings-form'

export const metadata = { title: 'Settings · Sales CRM' }

export default async function SettingsPage() {
  const viewer = await pageAccess(PERMISSIONS.ADMIN_MASTER)
  if (!viewer) return <AccessDenied what="application settings" />

  const rows = await prisma.appSetting.findMany({
    select: { key: true, value: true },
  })

  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]))

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        description="Application-wide defaults. Changes apply to records created from now on — nothing already saved is rewritten."
      />

      <SettingsForm values={values} />
    </div>
  )
}
