import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { AccessDenied } from '@/components/access-denied'
import { PageHeader } from '@/components/ui/page'

export const metadata = { title: 'Reports · Sales CRM' }

/**
 * The reports index (docs/03 §1).
 *
 * Eleven reports are specified and one is built. The rest are listed as coming
 * rather than hidden, because the sidebar has linked here since Phase 0 and an
 * index that silently showed a single card would read as "this is all there
 * is". Each arrives with the phase that has the data behind it — there is no
 * honest Revenue report before Phase 5 creates an invoice.
 */
const REPORTS: Array<{
  href: string | null
  title: string
  description: string
  phase: string
}> = [
  {
    href: '/reports/funnel',
    title: 'Vertical funnel',
    description:
      'Counters above the line, the bridge into leads, and stage-to-stage drop-off below it.',
    phase: 'Phase 3',
  },
  {
    href: null,
    title: 'Staffing',
    description:
      'Requirements, openings, profiles shared, interviews, selections and placements.',
    phase: 'Phase 4',
  },
  {
    href: null,
    title: 'Product demos',
    description: 'Inquiries, demos, quotations, orders and order value.',
    phase: 'Phase 5',
  },
  {
    href: null,
    title: 'Revenue',
    description: 'Pipeline, Won, Collected and Pending.',
    phase: 'Phase 5',
  },
  {
    href: null,
    title: 'Payment status',
    description: 'Paid, partial, pending and overdue, with the ageing on each.',
    phase: 'Phase 5',
  },
  {
    href: null,
    title: 'Lead source performance',
    description: 'Which sources produce leads, and which produce won deals.',
    phase: 'Phase 6',
  },
  {
    href: null,
    title: 'BDE lead generation',
    description: 'Counters, leads generated and conversion per BDE (README §27).',
    phase: 'Phase 6',
  },
  {
    href: null,
    title: 'BDM conversion',
    description: 'Leads worked, stage progression and win rate per BDM (README §28).',
    phase: 'Phase 6',
  },
  {
    href: null,
    title: 'Vertical performance',
    description: 'The eight verticals side by side.',
    phase: 'Phase 6',
  },
  {
    href: null,
    title: 'Pipeline aging',
    description: 'Leads past their stage threshold, and average time in stage.',
    phase: 'Phase 6',
  },
  {
    href: null,
    title: 'Won / lost analysis',
    description: 'Outcomes with the lost-reason breakdown.',
    phase: 'Phase 6',
  },
]

export default async function ReportsPage() {
  const viewer = await pageAccess(PERMISSIONS.REPORT_VIEW)
  if (!viewer) return <AccessDenied what="reports" />

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        description="Every report is filtered, drills through to the records behind it, and reads the same numbers the dashboard does."
      />

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((report) => {
          const body = (
            <>
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">
                  {report.title}
                </h2>
                {report.href ? null : (
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    {report.phase}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-500">{report.description}</p>
            </>
          )

          return (
            <li key={report.title}>
              {report.href ? (
                <a
                  href={report.href}
                  className="block h-full rounded-lg border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  {body}
                </a>
              ) : (
                <div className="h-full rounded-lg border border-dashed border-slate-200 bg-white/60 p-4">
                  {body}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
