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

/**
 * Display metadata for the permission matrix at /admin/permissions.
 *
 * `scoped` marks the ◐ rows in docs/03-screens-and-roles.md §2: capabilities
 * where holding the permission still does not mean seeing every record. Those
 * two things are separate on purpose — the grid says *what* a role may do, and
 * `src/lib/visibility.ts` decides *which records* they may do it to. Showing
 * the distinction here stops an administrator from ticking "View leads" for
 * BDE and expecting it to reveal the whole company's pipeline.
 */
export type PermissionMeta = {
  permission: Permission
  label: string
  /** Scope still applies: the role sees only their own or their team's records. */
  scoped?: boolean
  /**
   * Fenced by team membership as well as by this tick: the user must also be on
   * a team flagged for staffing at /admin/teams, unless they are an
   * Administrator. See `hasStaffingAccess` in
   * `src/lib/authz.ts`.
   */
  teamGated?: boolean
}

export const PERMISSION_GROUPS: Array<{
  heading: string
  permissions: PermissionMeta[]
}> = [
  {
    heading: 'Leads',
    permissions: [
      { permission: PERMISSIONS.LEAD_CREATE, label: 'Create lead' },
      { permission: PERMISSIONS.LEAD_VIEW, label: 'View leads', scoped: true },
      { permission: PERMISSIONS.LEAD_EDIT, label: 'Edit lead', scoped: true },
      { permission: PERMISSIONS.LEAD_STAGE_CHANGE, label: 'Change stage', scoped: true },
      { permission: PERMISSIONS.LEAD_ASSIGN, label: 'Assign / reassign lead', scoped: true },
      {
        permission: PERMISSIONS.LEAD_COMMERCIAL,
        label: 'Set deal value, mark Won / Lost',
        scoped: true,
      },
      { permission: PERMISSIONS.LEAD_DELETE, label: 'Delete (soft) lead', scoped: true },
    ],
  },
  {
    heading: 'Activity',
    permissions: [
      { permission: PERMISSIONS.PROSPECTING_LOG, label: 'Log prospecting counters' },
      {
        permission: PERMISSIONS.ACTIVITY_MANAGE,
        label: 'Add activities & documents',
        scoped: true,
      },
    ],
  },
  {
    heading: 'Staffing',
    permissions: [
      {
        permission: PERMISSIONS.STAFFING_REQUIREMENT_MANAGE,
        label: 'Manage requirements',
        scoped: true,
        teamGated: true,
      },
      {
        permission: PERMISSIONS.STAFFING_CANDIDATE_MANAGE,
        label: 'Manage candidates & submissions',
        scoped: true,
        teamGated: true,
      },
    ],
  },
  {
    heading: 'Commercials',
    permissions: [
      {
        permission: PERMISSIONS.COMMERCIAL_MANAGE,
        label: 'Contracts, quotations, invoices',
        scoped: true,
      },
      { permission: PERMISSIONS.COMMERCIAL_PAYMENT, label: 'Record payments', scoped: true },
    ],
  },
  {
    heading: 'Reporting',
    permissions: [
      { permission: PERMISSIONS.REPORT_VIEW, label: 'All other reports', scoped: true },
      { permission: PERMISSIONS.REPORT_REVENUE, label: 'View revenue KPIs', scoped: true },
      {
        permission: PERMISSIONS.REPORT_PERFORMANCE,
        label: 'BDE / BDM performance reports',
        scoped: true,
      },
      { permission: PERMISSIONS.DATA_EXPORT, label: 'Export data', scoped: true },
    ],
  },
  {
    heading: 'Administration',
    permissions: [
      { permission: PERMISSIONS.ADMIN_USERS, label: 'Manage users & teams' },
      { permission: PERMISSIONS.ADMIN_MASTER, label: 'Manage master data' },
      { permission: PERMISSIONS.ADMIN_AUDIT, label: 'View audit log' },
    ],
  },
]

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

  // Held by the former MANAGER tier, which a BDM now is. `commercial.payment`
  // is the one worth naming: raising an invoice and recording the money against
  // it are now the same person's job, so the second pair of eyes the split used
  // to imply is gone. Deliberate — see docs/00-decisions.md D13.
  PERMISSIONS.LEAD_DELETE,
  PERMISSIONS.COMMERCIAL_PAYMENT,
]

/**
 * Seeded into the `RolePermission` table. Admin can then toggle any cell from
 * /admin/permissions without a deployment — the database is authoritative at
 * runtime, this map is only the starting point.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  BDE: BDE_PERMISSIONS,
  BDM: BDM_PERMISSIONS,
  ADMIN: ALL_PERMISSIONS,
}
