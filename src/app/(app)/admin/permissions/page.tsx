import { prisma } from '@/lib/db'
import { pageAccess } from '@/lib/authz'
import { PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from '@/lib/permissions'
import { ROLE_ORDER } from '@/lib/roles'
import { AccessDenied } from '@/components/access-denied'
import { PageHeader } from '@/components/ui/page'
import { PermissionMatrix } from './matrix'

export const metadata = { title: 'Permissions · Sales CRM' }

export default async function PermissionsPage() {
  const viewer = await pageAccess(PERMISSIONS.ADMIN_MASTER)
  if (!viewer) return <AccessDenied what="the permission matrix" />

  // Matches the server-side gate in ./actions.ts: this grid can widen the very
  // capability that opens it, so the ADMIN role is required on top of
  // `admin.master`. See the note on `requireAdminRole` there.
  if (viewer.role !== 'ADMIN') {
    return <AccessDenied what="the permission matrix" />
  }

  const rows = await prisma.rolePermission.findMany({
    select: { role: true, permission: true, allowed: true },
  })

  const granted: Record<string, boolean> = {}

  // Seed the grid from code defaults first, then let the table override. A
  // capability added to src/lib/permissions.ts but not yet seeded would
  // otherwise render as unticked for every role, which reads as a deliberate
  // denial rather than "no row yet" — and `permissionsForRole` falls back to
  // exactly these defaults at runtime, so the grid would be lying.
  for (const role of ROLE_ORDER) {
    for (const permission of DEFAULT_ROLE_PERMISSIONS[role]) {
      granted[`${role}:${permission}`] = true
    }
  }

  for (const row of rows) {
    granted[`${row.role}:${row.permission}`] = row.allowed
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Role permissions"
        description="What each role may do. Changes take effect on the affected user's next request — no deployment, no sign-out."
      />

      <PermissionMatrix granted={granted} />
    </div>
  )
}
