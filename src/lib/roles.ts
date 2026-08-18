import type { UserRole } from '@/generated/prisma/enums'

/**
 * The three system roles (decision D13, revised), most senior first.
 *
 * Order matters wherever roles are listed side by side — the permission matrix
 * reads as a hierarchy only if the columns run in this direction.
 *
 * There were five. `MANAGER` and `SALES_HEAD` were removed because neither
 * described a distinct job here: a BDM *is* the manager, holding the same data
 * scope a Manager held and differing only by two permission cells, and the
 * Sales Head signs in as an administrator and creates further administrators.
 * Two roles nobody occupied were two more columns to keep truthful.
 */
export const ROLE_ORDER: UserRole[] = ['ADMIN', 'BDM', 'BDE']

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Administrator',
  BDM: 'BDM',
  BDE: 'BDE',
}

/** Short form, for table cells and badges where the full title is too wide. */
export const ROLE_SHORT_LABELS: Record<UserRole, string> = {
  ADMIN: 'Admin',
  BDM: 'BDM',
  BDE: 'BDE',
}

/**
 * Roles that can hold direct reports or manage a team. A BDE has no one
 * beneath them, so offering them as a reporting manager only creates chains
 * that `visibleUserIds` would have to walk for nothing.
 */
export const MANAGERIAL_ROLES: UserRole[] = ['ADMIN', 'BDM']
