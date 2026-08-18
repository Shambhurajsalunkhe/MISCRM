import 'server-only'

import { cache } from 'react'

import { prisma } from '@/lib/db'
import { requireUser, type CurrentUser } from '@/lib/auth/session'
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
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

/**
 * Staffing is the one module gated by *team* as well as by role.
 *
 * The permission matrix answers "may a BDE manage candidates at all", which is
 * a company-wide statement about the role — and the answer stayed yes even for
 * the BDEs who have never touched a requirement. Recruitment sits with one team
 * inside Sales, so the second question is which team the person is on, and
 * that is a data fact rather than another row in the matrix.
 *
 * Both are required: the permission says what the role may do, the flag says
 * whose work it is. Turning the flag on for a team does not hand its BDEs
 * capabilities their role never had.
 */
const STAFFING_PERMISSIONS = new Set<string>([
  PERMISSIONS.STAFFING_REQUIREMENT_MANAGE,
  PERMISSIONS.STAFFING_CANDIDATE_MANAGE,
])

/**
 * Roles that reach staffing without belonging to a staffing team. Admin only:
 * it administers the module, and locking it out of a vertical it is accountable
 * for would only produce a support call. This was ['ADMIN', 'SALES_HEAD'] until
 * the role set went to three (D13); the fence itself did not change.
 */
const STAFFING_EXEMPT_ROLES: UserRole[] = ['ADMIN']

const teamStaffingAccess = cache(async (teamId: string) => {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { staffingAccess: true },
  })
  return team?.staffingAccess ?? false
})

/**
 * Whether this user is inside the staffing module's fence at all — before any
 * question of which records they may see, which stays with `visibility.ts`.
 *
 * Deliberately does not consider `Team.isActive`: deactivating a team hides it
 * from the pickers and leaves its members where they are, and taking their
 * screens away as a side effect of tidying the org chart would be a surprise.
 */
export async function hasStaffingAccess(user: CurrentUser): Promise<boolean> {
  if (STAFFING_EXEMPT_ROLES.includes(user.role)) return true
  if (!user.teamId) return false
  return teamStaffingAccess(user.teamId)
}

export async function can(
  user: CurrentUser,
  permission: Permission,
): Promise<boolean> {
  const granted = await permissionsForRole(user.role)
  if (!granted.has(permission)) return false

  // Applied here rather than at each screen so the sidebar, all sixteen
  // staffing pages, their server actions, the lead's Requirements tab, global
  // search and the report exports are all closed by the same check — none of
  // them can be the one that forgot.
  if (STAFFING_PERMISSIONS.has(permission)) {
    return hasStaffingAccess(user)
  }

  return true
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
