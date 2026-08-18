'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/lib/db'
import { withAudit } from '@/lib/action'
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  type Permission,
} from '@/lib/permissions'
import { ROLE_ORDER } from '@/lib/roles'
import type { UserRole } from '@/generated/prisma/enums'
import { actionError, actionSuccess, type ActionState } from '@/lib/form'
import type { CurrentUser } from '@/lib/auth/session'

/**
 * Editing the matrix is restricted to the ADMIN *role*, not to a capability.
 *
 * Gating it on `admin.master` alone was an escalation path: `admin.master` is
 * itself one of the cells in this grid, so an administrator who granted it to,
 * say, BDM would have handed every BDM the ability to edit the grid — and
 * from there to grant themselves every remaining capability, including
 * `admin.users`. A permission that can widen itself is not a boundary.
 *
 * `admin.master` is still required as well, so the capability continues to mean
 * what the docs say it means for every other master-data screen.
 */
function requireAdminRole(actor: CurrentUser): ActionState | null {
  return actor.role === 'ADMIN'
    ? null
    : actionError(
        'Only an administrator can change the permission matrix.',
      )
}

/** Checkbox names are `perm:<ROLE>:<permission>`. */
function cellName(role: UserRole, permission: Permission): string {
  return `perm:${role}:${permission}`
}

/**
 * An administrator who removes `admin.master` from ADMIN can no longer reach
 * this screen to put it back — the only remaining route is a SQL console. The
 * matrix is meant to be a safe place to experiment, so this one cell is fixed.
 */
function isLockoutRisk(role: UserRole, permission: Permission): boolean {
  return (
    role === 'ADMIN' &&
    (permission === PERMISSIONS.ADMIN_MASTER ||
      permission === PERMISSIONS.ADMIN_USERS)
  )
}

async function applyMatrix(
  desired: Map<string, boolean>,
): Promise<{ changed: number }> {
  const current = await prisma.rolePermission.findMany({
    select: { id: true, role: true, permission: true, allowed: true },
  })

  const currentByKey = new Map(
    current.map((row) => [`${row.role}:${row.permission}`, row]),
  )

  let changed = 0

  for (const [key, allowed] of desired) {
    const existing = currentByKey.get(key)

    if (!existing) {
      const [role, ...rest] = key.split(':')
      await prisma.rolePermission.create({
        data: {
          role: role as UserRole,
          permission: rest.join(':'),
          allowed,
        },
      })
      changed += 1
      continue
    }

    // Only write the cells that actually moved. The ORM audit writer skips
    // no-op updates anyway, but 100 round-trips per save is not free, and a
    // save that changed one checkbox should read as one change in the trail.
    if (existing.allowed !== allowed) {
      await prisma.rolePermission.update({
        where: { id: existing.id },
        data: { allowed },
      })
      changed += 1
    }
  }

  return { changed }
}

export async function savePermissionsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ADMIN_MASTER, async (actor) => {
    const denied = requireAdminRole(actor)
    if (denied) return denied

    const desired = new Map<string, boolean>()

    for (const role of ROLE_ORDER) {
      for (const permission of ALL_PERMISSIONS) {
        const allowed = isLockoutRisk(role, permission)
          ? true
          : formData.get(cellName(role, permission)) !== null

        desired.set(`${role}:${permission}`, allowed)
      }
    }

    const { changed } = await applyMatrix(desired)

    revalidatePath('/admin/permissions')
    // The sidebar and admin tabs are permission-filtered, so a change here can
    // alter navigation for everyone. Their next request re-reads the table.
    revalidatePath('/', 'layout')

    return changed === 0
      ? actionSuccess('No changes to save.')
      : actionSuccess(
          `${changed} permission${changed === 1 ? '' : 's'} updated. Affected users see the change on their next request.`,
        )
  })
}

export async function resetPermissionsAction(
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ADMIN_MASTER, async (actor) => {
    const denied = requireAdminRole(actor)
    if (denied) return denied

    const desired = new Map<string, boolean>()

    for (const role of ROLE_ORDER) {
      const defaults = new Set<string>(DEFAULT_ROLE_PERMISSIONS[role])
      for (const permission of ALL_PERMISSIONS) {
        desired.set(`${role}:${permission}`, defaults.has(permission))
      }
    }

    const { changed } = await applyMatrix(desired)

    revalidatePath('/admin/permissions')
    revalidatePath('/', 'layout')

    return changed === 0
      ? actionSuccess('Already at the defaults.')
      : actionSuccess(`Reset to defaults — ${changed} cell(s) changed.`)
  })
}
