import { PERMISSIONS, type Permission } from '@/lib/permissions'

export type NavItem = {
  label: string
  href: string
  /** Omitted means every signed-in user sees it. */
  permission?: Permission
}

export type NavSection = {
  heading: string
  items: NavItem[]
}

/**
 * Sidebar structure. Routes that do not exist yet are added as phases land —
 * see docs/04-implementation-plan.md.
 */
export const NAVIGATION: NavSection[] = [
  {
    heading: 'Overview',
    items: [{ label: 'Dashboard', href: '/' }],
  },
  {
    heading: 'Sales',
    items: [
      { label: 'Leads', href: '/leads', permission: PERMISSIONS.LEAD_VIEW },
      { label: 'Clients', href: '/clients', permission: PERMISSIONS.LEAD_VIEW },
      {
        label: 'Prospecting',
        href: '/prospecting',
        permission: PERMISSIONS.PROSPECTING_LOG,
      },
    ],
  },
  {
    heading: 'Staffing',
    items: [
      {
        label: 'Requirements',
        href: '/requirements',
        permission: PERMISSIONS.STAFFING_REQUIREMENT_MANAGE,
      },
      {
        label: 'Candidates',
        href: '/candidates',
        permission: PERMISSIONS.STAFFING_CANDIDATE_MANAGE,
      },
      {
        label: 'Placements',
        href: '/placements',
        permission: PERMISSIONS.STAFFING_REQUIREMENT_MANAGE,
      },
    ],
  },
  {
    heading: 'Commercials',
    items: [
      {
        label: 'Invoices',
        href: '/invoices',
        permission: PERMISSIONS.COMMERCIAL_MANAGE,
      },
    ],
  },
  {
    heading: 'Insights',
    items: [
      {
        label: 'Reports',
        href: '/reports',
        permission: PERMISSIONS.REPORT_VIEW,
      },
    ],
  },
  {
    heading: 'Administration',
    items: [
      { label: 'Users', href: '/admin/users', permission: PERMISSIONS.ADMIN_USERS },
      { label: 'Teams', href: '/admin/teams', permission: PERMISSIONS.ADMIN_USERS },
      {
        label: 'Permissions',
        href: '/admin/permissions',
        permission: PERMISSIONS.ADMIN_MASTER,
      },
      {
        label: 'Master Data',
        href: '/admin/master',
        permission: PERMISSIONS.ADMIN_MASTER,
      },
      {
        label: 'Audit Log',
        href: '/admin/audit',
        permission: PERMISSIONS.ADMIN_AUDIT,
      },
    ],
  },
]
