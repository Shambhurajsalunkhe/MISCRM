import type { UserRole } from '@/generated/prisma/enums'

/**
 * Capability catalogue.
 *
 * A permission answers "may this role do X at all". It deliberately says
 * nothing about *which records* — that is data scope, handled separately in
 * `src/lib/visibility.ts`. The two combine to produce the ◐ ("own/team scope
 * only") cells in docs/03-screens-and-roles.md §2.
 */
export const PERMISSIONS = {
  LEAD_CREATE: 'lead.create',
  LEAD_VIEW: 'lead.view',
  LEAD_EDIT: 'lead.edit',
  LEAD_STAGE_CHANGE: 'lead.stage',
  LEAD_ASSIGN: 'lead.assign',
  /** Set deal value, mark Won / Lost. */
  LEAD_COMMERCIAL: 'lead.commercial',
  LEAD_DELETE: 'lead.delete',

  PROSPECTING_LOG: 'prospecting.log',
  ACTIVITY_MANAGE: 'activity.manage',

  STAFFING_REQUIREMENT_MANAGE: 'staffing.requirement.manage',
  STAFFING_CANDIDATE_MANAGE: 'staffing.candidate.manage',

  /** Contracts, quotations, invoices. */
  COMMERCIAL_MANAGE: 'commercial.manage',
  COMMERCIAL_PAYMENT: 'commercial.payment',

  REPORT_VIEW: 'report.view',
  REPORT_REVENUE: 'report.revenue',
  REPORT_PERFORMANCE: 'report.performance',
  DATA_EXPORT: 'data.export',

  ADMIN_USERS: 'admin.users',
  ADMIN_MASTER: 'admin.master',
  ADMIN_AUDIT: 'admin.audit',
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS)

const BDE_PERMISSIONS: Permission[] = [
  PERMISSIONS.LEAD_CREATE,
  PERMISSIONS.LEAD_VIEW,
  PERMISSIONS.LEAD_EDIT,
  PERMISSIONS.LEAD_ASSIGN,
  PERMISSIONS.PROSPECTING_LOG,
  PERMISSIONS.ACTIVITY_MANAGE,
  PERMISSIONS.STAFFING_CANDIDATE_MANAGE,
]

const BDM_PERMISSIONS: Permission[] = [
  ...BDE_PERMISSIONS,
  PERMISSIONS.LEAD_STAGE_CHANGE,
  PERMISSIONS.LEAD_COMMERCIAL,
  PERMISSIONS.STAFFING_REQUIREMENT_MANAGE,
  PERMISSIONS.COMMERCIAL_MANAGE,
  PERMISSIONS.REPORT_VIEW,
  PERMISSIONS.REPORT_REVENUE,
  PERMISSIONS.REPORT_PERFORMANCE,
  PERMISSIONS.DATA_EXPORT,
]

const MANAGER_PERMISSIONS: Permission[] = [
  ...BDM_PERMISSIONS,
  PERMISSIONS.LEAD_DELETE,
  PERMISSIONS.COMMERCIAL_PAYMENT,
]

const SALES_HEAD_PERMISSIONS: Permission[] = [
  ...MANAGER_PERMISSIONS,
  PERMISSIONS.ADMIN_USERS,
  PERMISSIONS.ADMIN_AUDIT,
]

/**
 * Seeded into the `RolePermission` table. Admin can then toggle any cell from
 * /admin/permissions without a deployment — the database is authoritative at
 * runtime, this map is only the starting point.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  BDE: BDE_PERMISSIONS,
  BDM: BDM_PERMISSIONS,
  MANAGER: MANAGER_PERMISSIONS,
  SALES_HEAD: SALES_HEAD_PERMISSIONS,
  ADMIN: ALL_PERMISSIONS,
}
