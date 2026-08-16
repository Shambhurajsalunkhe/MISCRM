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

/**
 * Guard for a *page*, which wants to render an explanation rather than throw.
 *
 * Returns `null` when the signed-in user lacks the capability, so the page can
 * render `<AccessDenied />`. Pages get this instead of `requirePermission`
 * because a 500 error page is the wrong answer to "you may not see this", and
 * a 404 is the wrong answer for an internal tool where the screen demonstrably
 * exists — the user just isn't the one who administers it.
 *
 * This is only a second line of defence. The sidebar and the admin sub-nav
 * already hide links a user cannot follow; this covers someone typing the URL.
 * Mutations are guarded independently in the server actions, so a page that
 * forgets this check still cannot be used to change anything.
 */
export async function pageAccess(
  permission: Permission,
): Promise<CurrentUser | null> {
  const user = await requireUser()
  return (await can(user, permission)) ? user : null
}

/** True if the user holds at least one of the given capabilities. */
export async function canAny(
  user: CurrentUser,
  permissions: Permission[],
): Promise<boolean> {
  for (const permission of permissions) {
    if (await can(user, permission)) return true
  }
  return false
}
