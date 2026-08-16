import { requireUser } from '@/lib/auth/session'
import { can } from '@/lib/authz'
import { PERMISSIONS, type Permission } from '@/lib/permissions'
import { AccessDenied } from '@/components/access-denied'
import { LinkTabs } from '@/components/ui/tabs'

const TABS: Array<{ label: string; href: string; permission: Permission }> = [
  { label: 'Users', href: '/admin/users', permission: PERMISSIONS.ADMIN_USERS },
  { label: 'Teams', href: '/admin/teams', permission: PERMISSIONS.ADMIN_USERS },
  {
    label: 'Permissions',
    href: '/admin/permissions',
    permission: PERMISSIONS.ADMIN_MASTER,
  },
  {
    label: 'Master data',
    href: '/admin/master',
    permission: PERMISSIONS.ADMIN_MASTER,
  },
  {
    label: 'Settings',
    href: '/admin/settings',
    permission: PERMISSIONS.ADMIN_MASTER,
  },
  {
    label: 'Audit log',
    href: '/admin/audit',
    permission: PERMISSIONS.ADMIN_AUDIT,
  },
]

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireUser()

  // The sub-nav shows only the sections this user administers. Sales Head, for
  // example, holds admin.users and admin.audit but not admin.master, so they
  // get Users, Teams and Audit log and nothing else (docs/03 §2).
  const tabs = []
  for (const tab of TABS) {
    if (await can(user, tab.permission)) tabs.push(tab)
  }

  if (tabs.length === 0) return <AccessDenied what="administration" />

  return (
    <div className="space-y-6">
      <LinkTabs tabs={tabs.map(({ label, href }) => ({ label, href }))} />
      {children}
    </div>
  )
}
