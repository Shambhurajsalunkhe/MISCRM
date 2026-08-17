import { can, pageAccess } from '@/lib/authz'
import { PERMISSIONS, type Permission } from '@/lib/permissions'
import {
  analyticsQuery,
  pickAnalyticsFilters,
} from '@/lib/reports/filters'
import { AccessDenied } from '@/components/access-denied'
import { PageHeader } from '@/components/ui/page'

export const metadata = { title: 'Reports · Sales CRM' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * The reports index (docs/03 §1).
 *
 * All eleven, built. Each card carries whatever filter state the visitor arrived
 * with — a Sales Head who narrowed the dashboard to August and Upwork stays in
 * August and Upwork when they open a report, which is what makes the drill-down
 * chain of README §37 continuous rather than a set of screens that each start
 * from scratch.
 *
 * Two of the eleven sit behind their own permissions rather than `report.view`,
 * per the matrix in docs/03 §2 — the performance reports and the money ones — and
 * a card the visitor cannot open is not shown. A hard-coded list still, and each
 * new report has to be added here as well as routed; at eleven that is cheaper
 * than a registry, and the export registry already keys them by the same names.
 */
const REPORTS: Array<{
  href: string
  title: string
  description: string
  permission: Permission
  /** Whether the filter state carries over — the two Phase 3/4 reports use their
   *  own narrower parameter names, so handing them these would silently drop
   *  half of it and misread the rest. */
  carriesFilters: boolean
}> = [
  {
    href: '/reports/vertical',
    title: 'Vertical performance',
    description:
      'Every vertical side by side: intake above the line, outcomes below it, and what each was worth.',
    permission: PERMISSIONS.REPORT_VIEW,
    carriesFilters: true,
  },
  {
    href: '/reports/funnel',
    title: 'Vertical funnel',
    description:
      'Counters above the line, the bridge into leads, and stage-to-stage drop-off below it.',
    permission: PERMISSIONS.REPORT_VIEW,
    carriesFilters: false,
  },
  {
    href: '/reports/lead-source',
    title: 'Lead source performance',
    description:
      'Which sources produce leads, and which produce won deals — rarely the same order.',
    permission: PERMISSIONS.REPORT_VIEW,
    carriesFilters: true,
  },
  {
    href: '/reports/bde',
    title: 'BDE lead generation',
    description:
      'Counters logged, leads generated and the bridge between them, per person (README §27).',
    permission: PERMISSIONS.REPORT_PERFORMANCE,
    carriesFilters: true,
  },
  {
    href: '/reports/bdm',
    title: 'BDM conversion',
    description:
      'Leads owned, how far each person moved them, and the win rate (README §28).',
    permission: PERMISSIONS.REPORT_PERFORMANCE,
    carriesFilters: true,
  },
  {
    href: '/reports/aging',
    title: 'Pipeline aging',
    description:
      'Leads past the threshold set for their own stage, and the stages where deals lose time.',
    permission: PERMISSIONS.REPORT_VIEW,
    carriesFilters: true,
  },
  {
    href: '/reports/won-lost',
    title: 'Won / lost analysis',
    description:
      'Deals decided in the period, the lost-reason breakdown, and the sales cycle behind each outcome.',
    permission: PERMISSIONS.REPORT_VIEW,
    carriesFilters: true,
  },
  {
    href: '/reports/revenue',
    title: 'Revenue',
    description:
      'Pipeline, Won, Collected and Pending, per vertical and reconciled against what has been invoiced.',
    permission: PERMISSIONS.REPORT_REVENUE,
    carriesFilters: true,
  },
  {
    href: '/reports/payments',
    title: 'Payment status',
    description:
      'What was billed, what has arrived, and an ageing ladder over everything still owed.',
    permission: PERMISSIONS.REPORT_REVENUE,
    carriesFilters: true,
  },
  {
    href: '/reports/staffing',
    title: 'Staffing',
    description:
      'Requirements, openings, profiles shared, interviews, selections and placements.',
    permission: PERMISSIONS.REPORT_VIEW,
    carriesFilters: false,
  },
  {
    href: '/reports/product-demos',
    title: 'Product demos',
    description:
      'Inquiries, demos held, proposals, orders and order value — wherever demos are switched on.',
    permission: PERMISSIONS.REPORT_VIEW,
    carriesFilters: true,
  },
]

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.REPORT_VIEW)
  if (!viewer) return <AccessDenied what="reports" />

  const filters = pickAnalyticsFilters(await searchParams)
  const query = analyticsQuery(filters)

  const [canSeeRevenue, canSeePerformance] = await Promise.all([
    can(viewer, PERMISSIONS.REPORT_REVENUE),
    can(viewer, PERMISSIONS.REPORT_PERFORMANCE),
  ])

  const visible = REPORTS.filter((report) => {
    if (report.permission === PERMISSIONS.REPORT_REVENUE) return canSeeRevenue
    if (report.permission === PERMISSIONS.REPORT_PERFORMANCE) {
      return canSeePerformance
    }
    return true
  })

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        description="Every report is filtered, drills through to the records behind it, exports to Excel, PDF and CSV, and reads the same numbers the dashboard does."
      />

      {query ? (
        <p className="text-xs text-slate-500">
          Carrying the filters you arrived with. Reports that use their own
          parameter names — the funnel and staffing, which are per vertical and
          per person rather than per filter set — start fresh, because passing
          these through would misread half of them.
        </p>
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((report) => (
          <li key={report.title}>
            <a
              href={
                report.carriesFilters && query
                  ? `${report.href}?${query}`
                  : report.href
              }
              className="block h-full rounded-lg border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <h2 className="text-sm font-semibold text-slate-900">
                {report.title}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {report.description}
              </p>
            </a>
          </li>
        ))}
      </ul>

      <p className="text-xs text-slate-500">
        Numbers on these screens follow three rules, stated on each report: counts
        are the leads <strong>created</strong> in the period; stage and outcome
        figures are dated by <strong>when the transition happened</strong>; and
        pipeline and pending money are <strong>as at today</strong>, whatever the
        date range says.
      </p>
    </div>
  )
}
