import type { UserRole } from '@/generated/prisma/enums'

/**
 * The five system roles (decision D13), most senior first.
 *
 * Order matters wherever roles are listed side by side — the permission matrix
 * reads as a hierarchy only if the columns run in this direction.
 */
export const ROLE_ORDER: UserRole[] = [
  'ADMIN',
  'SALES_HEAD',
  'MANAGER',
  'BDM',
  'BDE',
]

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Administrator',
  SALES_HEAD: 'Sales Head',
  MANAGER: 'Manager',
  BDM: 'BDM',
  BDE: 'BDE',
}

/** Short form, for table cells and badges where the full title is too wide. */
export const ROLE_SHORT_LABELS: Record<UserRole, string> = {
  ADMIN: 'Admin',
  SALES_HEAD: 'Sales Head',
  MANAGER: 'Manager',
  BDM: 'BDM',
  BDE: 'BDE',
}

/**
 * Roles that can hold direct reports or manage a team. A BDE has no one
 * beneath them, so offering them as a reporting manager only creates chains
 * that `visibleUserIds` would have to walk for nothing.
 */
export const MANAGERIAL_ROLES: UserRole[] = [
  'ADMIN',
  'SALES_HEAD',
  'MANAGER',
  'BDM',
]
