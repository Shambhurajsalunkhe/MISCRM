import 'server-only'

import { cache } from 'react'

import { prisma } from '@/lib/db'
import { requireUser, type CurrentUser } from '@/lib/auth/session'
import {
  DEFAULT_ROLE_PERMISSIONS,
  type Permission,
} from '@/lib/permissions'
import { AuthorizationError } from '@/lib/errors'
import type { UserRole } from '@/generated/prisma/enums'

/**
 * Effective permissions for a role, read from the database so Admin's toggles
 * in /admin/permissions take effect immediately. Falls back to the seeded
 * defaults if the table has no rows for the role yet.
 */
const permissionsForRole = cache(async (role: UserRole) => {
  const rows = await prisma.rolePermission.findMany({
    where: { role },
    select: { permission: true, allowed: true },
  })

  if (rows.length === 0) {
    return new Set<string>(DEFAULT_ROLE_PERMISSIONS[role])
  }

  return new Set(
    rows.filter((row) => row.allowed).map((row) => row.permission),
  )
})

export async function can(
  user: CurrentUser,
  permission: Permission,
): Promise<boolean> {
  const granted = await permissionsForRole(user.role)
  return granted.has(permission)
}

/**
 * Guard for server actions and route handlers. Throws rather than returning a
 * boolean so a forgotten `if` cannot silently allow the action through.
 */
export async function requirePermission(
  permission: Permission,
): Promise<CurrentUser> {
  const user = await requireUser()

  if (!(await can(user, permission))) {
    throw new AuthorizationError(permission)
  }

  return user
}
