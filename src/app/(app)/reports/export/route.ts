import { getCurrentUser } from '@/lib/auth/session'
import { can } from '@/lib/authz'
import { recordAudit } from '@/lib/audit/record'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { reportResponse } from '@/lib/reports/export'
import { ANALYTICS_FILTER_KEYS } from '@/lib/reports/filters'
import { REPORT_REGISTRY } from '@/lib/reports/registry'
import { isReportFormat, withoutMoney } from '@/lib/reports/table'

/**
 * One route for every report and every format (README §29).
 *
 * `?report=<key>&format=csv|xlsx|pdf` plus whatever filters the screen was
 * showing. The registry's `build` then calls the same loader the page called with
 * the same parameters, which is what makes the file match the screen — and since
 * the loaders are also where the data scope is applied, there is no second query
 * that could quietly widen it.
 *
 * Two permissions are checked, not one. `data.export` says whether this person
 * may take data out of the system at all; the report's own permission says
 * whether they may see these particular numbers. A BDM without
 * `report.revenue` cannot pull the revenue report by URL even though they can
 * export the vertical one.
 *
 * Node runtime, not edge: ExcelJS and React PDF are both Node libraries, and the
 * PDF renderer needs Buffer.
 */
export const runtime = 'nodejs'

/**
 * The filter set as one short string for the audit row.
 *
 * Built from the parameters the reports actually understand rather than from
 * `url.search`, and capped. The trail exists to answer "who took what out, under
 * which filters"; recording the raw query string would let anything appended to
 * the URL be written into `AuditLog` verbatim, which turns an audit row into a
 * place to store somebody else's text. `report` and `format` are dropped because
 * both are already recorded in their own fields.
 */
const AUDITED_KEYS = [
  ...ANALYTICS_FILTER_KEYS,
  // The funnel and the staffing report parse the narrower prospecting set.
  'user',
] as const

const MAX_AUDIT_FILTERS = 300

function auditFilters(url: URL): string {
  const parts: string[] = []

  for (const key of AUDITED_KEYS) {
    const value = url.searchParams.get(key)
    if (value) parts.push(`${key}=${value.slice(0, 60)}`)
  }

  if (parts.length === 0) return '(none)'
  return parts.join('&').slice(0, MAX_AUDIT_FILTERS)
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return new Response('Unauthorised', { status: 401 })

  const url = new URL(request.url)
  const key = url.searchParams.get('report')
  const format = url.searchParams.get('format') ?? 'csv'

  const definition = key ? REPORT_REGISTRY[key] : undefined
  if (!definition) {
    return new Response('Unknown report', { status: 404 })
  }

  if (!isReportFormat(format)) {
    return new Response('Unsupported format', { status: 400 })
  }

  if (!(await can(user, PERMISSIONS.DATA_EXPORT))) {
    return new Response('Forbidden', { status: 403 })
  }

  if (!(await can(user, definition.permission))) {
    return new Response('Forbidden', { status: 403 })
  }

  const params = Object.fromEntries(url.searchParams)
  const [built, symbol, canSeeRevenue] = await Promise.all([
    definition.build(user, params),
    currencySymbol(),
    can(user, PERMISSIONS.REPORT_REVENUE),
  ])

  // The screens hide their money from a viewer without `report.revenue`; an
  // export that carried the amounts anyway would be a way around that. Reports
  // that sit behind the permission in their entirety need no stripping.
  const table =
    canSeeRevenue || definition.permission === PERMISSIONS.REPORT_REVENUE
      ? built
      : withoutMoney(built)

  // `AuditAction.EXPORT` exists for this: a report leaving the system is not a
  // row change, so the ORM writer never sees it, but it is one of the events the
  // trail is kept for. The filter string is recorded because *which* rows left
  // matters as much as that some did.
  await recordAudit({
    entityType: 'LEAD',
    entityId: 'export',
    action: 'EXPORT',
    fieldName: `(report: ${definition.key})`,
    newValue: `${table.rows.length} row(s) as ${format}; filters=${auditFilters(url)}`,
    userId: user.id,
  })

  return reportResponse(table, format, definition.basename, symbol)
}
