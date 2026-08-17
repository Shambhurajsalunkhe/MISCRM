import { can, pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { formatMoney } from '@/lib/format'
import { formatCounterDate } from '@/lib/prospecting/dates'
import { formatRate, rate } from '@/lib/prospecting/metrics'
import { analyticsQuery, leadListHref, resolveAnalytics } from '@/lib/reports/filters'
import { filterOptions } from '@/lib/reports/options'
import { AGING_LIMIT, loadAging } from '@/lib/reports/data/aging'
import {
  COMMON_STAGE_LABELS,
  PRIORITY_LABELS,
  PRIORITY_TONES,
} from '@/lib/leads/display'
import { AccessDenied } from '@/components/access-denied'
import { AnalyticsFilterBar } from '@/components/analytics-filters'
import { Bars } from '@/components/charts/bars'
import { ExportButtons } from '@/components/export-buttons'
import { Badge } from '@/components/ui/badge'
import { Card, EmptyState, PageHeader } from '@/components/ui/page'
import { Stat, StatRow } from '@/components/ui/stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'

export const metadata = { title: 'Pipeline aging · Sales CRM' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const number = (value: number) => value.toLocaleString('en-GB')

/**
 * Pipeline Aging (README §29, docs/02 §6).
 *
 * Two questions, and the report keeps them apart because the answers point at
 * different things: *which leads are stuck* (a list of deals to chase) and
 * *which stages are slow* (a process to fix).
 *
 * The threshold is per stage and per vertical, editable in Master Data — a lead
 * may sit in Negotiation far longer than it may sit in Requirement Gathering, and
 * a single company-wide number would either flag everything or nothing. Which is
 * why every row shows the days, the threshold and the overrun rather than a red
 * dot: "9 days over its 14" is actionable, "late" is not.
 *
 * This screen also closes the gap the requirement list left in Phase 4, which
 * could only offer "not moved in 14 days" because the per-stage threshold cannot
 * be expressed in SQL. Here the comparison happens in memory, so it is the real
 * one.
 */
export default async function AgingReportPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.REPORT_VIEW)
  if (!viewer) return <AccessDenied what="reports" />

  const params = await searchParams
  const scope = await resolveAnalytics(viewer, params)

  const [report, options, symbol, canExport] = await Promise.all([
    loadAging(scope),
    filterOptions(viewer),
    currencySymbol(),
    can(viewer, PERMISSIONS.DATA_EXPORT),
  ])

  const query = analyticsQuery({
    ...scope.filters,
    from: scope.range.fromKey,
    to: scope.range.toKey,
  })

  const valueAtRisk = report.leads.reduce((sum, lead) => sum + lead.value, 0)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pipeline aging"
        description="Open leads that have sat in their stage longer than that stage allows, and the stages where deals lose the most time."
        actions={
          canExport ? <ExportButtons report="aging" query={query} /> : undefined
        }
      />

      <AnalyticsFilterBar
        action="/reports/aging"
        filters={scope.filters}
        from={scope.range.fromKey}
        to={scope.range.toKey}
        options={options}
      />

      <p className="text-xs text-slate-500">
        The lead list below is <strong>as at today</strong> and ignores the date
        range — a deal is stuck now or it is not. The date range applies to the
        average-time-in-stage table at the bottom, which reads transitions that
        happened in the window ({formatCounterDate(scope.range.from)} to{' '}
        {formatCounterDate(scope.range.to)}).
      </p>

      <StatRow>
        <Stat
          label="Open leads in scope"
          value={number(report.openLeads)}
          href={leadListHref(scope, { status: 'OPEN' }, false)}
        />
        <Stat
          label="Past their threshold"
          value={number(report.flagged)}
          hint={`${formatRate(rate(report.flagged, report.openLeads))} of the open pipeline`}
        />
        <Stat
          label="Value at risk"
          value={formatMoney(valueAtRisk, symbol)}
          hint="Deal value, or expected budget where none is agreed"
        />
        <Stat
          label="Longest wait"
          value={
            report.leads[0]
              ? `${number(report.leads[0].days)} days`
              : '—'
          }
          hint={report.leads[0] ? report.leads[0].leadCode : 'Nothing flagged'}
          tone="muted"
        />
      </StatRow>

      {report.truncated ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          More than {number(AGING_LIMIT)} open leads matched, so the ageing
          comparison ran on the {number(AGING_LIMIT)} oldest. Narrow the filters
          for an exact count.
        </p>
      ) : null}

      <Card
        title="Leads past their stage threshold"
        description="Oldest first. The threshold is the one configured for that lead's own stage, in its own vertical."
      >
        {report.leads.length === 0 ? (
          <EmptyState>
            Nothing is past its threshold — every open lead has moved inside the
            time its stage allows.
            {report.stagesWithoutThreshold.length > 0
              ? ` Note that ${report.stagesWithoutThreshold.length} stage(s) have no threshold set, so leads sitting in them can never be flagged.`
              : ''}
          </EmptyState>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Lead</TH>
                <TH>Client</TH>
                <TH>Vertical</TH>
                <TH>Stage</TH>
                <TH>Owner</TH>
                <TH>Priority</TH>
                <TH className="text-right">Days in stage</TH>
                <TH className="text-right">Threshold</TH>
                <TH className="text-right">Over by</TH>
                <TH className="text-right">Value</TH>
              </TR>
            </THead>
            <TBody>
              {report.leads.map((lead) => (
                <TR key={lead.id}>
                  <TD className="font-medium text-slate-900">
                    <a href={`/leads/${lead.id}`} className="hover:underline">
                      {lead.leadCode}
                    </a>
                    <span className="block max-w-60 truncate text-xs text-slate-500">
                      {lead.title}
                    </span>
                  </TD>
                  <TD>{lead.client}</TD>
                  <TD className="text-slate-500">{lead.vertical}</TD>
                  <TD>{lead.stage ?? '—'}</TD>
                  <TD className="text-slate-500">
                    {lead.owner ?? (
                      <span className="text-amber-700">Unassigned</span>
                    )}
                  </TD>
                  <TD>
                    <Badge tone={PRIORITY_TONES[lead.priority]}>
                      {PRIORITY_LABELS[lead.priority]}
                    </Badge>
                  </TD>
                  <TD className="text-right tabular-nums">
                    {number(lead.days)}
                  </TD>
                  <TD className="text-right tabular-nums text-slate-500">
                    {lead.threshold === null ? '—' : number(lead.threshold)}
                  </TD>
                  <TD className="text-right font-medium tabular-nums text-rose-700">
                    {lead.over === null ? '—' : `+${number(lead.over)}`}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {lead.value > 0 ? formatMoney(lead.value, symbol) : '—'}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Where the stuck deals are"
          description="Flagged leads by common stage. The number on the right is how many open leads sit in that bucket altogether."
        >
          <Bars
            bars={report.byStage.map((bucket) => ({
              key: bucket.stage,
              label: COMMON_STAGE_LABELS[bucket.stage],
              value: bucket.flagged,
              note: `of ${bucket.total}`,
              href: leadListHref(
                scope,
                { stage: bucket.stage, status: 'OPEN' },
                false,
              ),
              tone: bucket.flagged > 0 ? 'lost' : 'muted',
            }))}
            emptyLabel="No open leads in scope."
          />
        </Card>

        <Card
          title="Average time in stage"
          description="Over stays that ended in this period — a lead still sitting somewhere contributes nothing until it moves, which is why the transition count matters."
        >
          {report.bottlenecks.length === 0 ? (
            <EmptyState>
              No stage transitions in this period, so there is no average to
              take.
            </EmptyState>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Stage</TH>
                  <TH>Vertical</TH>
                  <TH className="text-right">Average</TH>
                  <TH className="text-right">Transitions</TH>
                </TR>
              </THead>
              <TBody>
                {report.bottlenecks.map((row) => (
                  <TR key={row.stageId}>
                    <TD className="font-medium text-slate-900">{row.stage}</TD>
                    <TD className="text-slate-500">{row.vertical}</TD>
                    <TD className="text-right tabular-nums">
                      {(row.hours / 24).toFixed(1)} days
                    </TD>
                    <TD className="text-right tabular-nums text-slate-500">
                      {number(row.transitions)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>

      {report.stagesWithoutThreshold.length > 0 ? (
        <p className="text-xs text-slate-500">
          Stages with no aging threshold configured, so leads in them are never
          flagged: {report.stagesWithoutThreshold.join('; ')}. An administrator
          sets these per stage in Master Data → Stages.
        </p>
      ) : null}
    </div>
  )
}
