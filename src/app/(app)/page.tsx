import { requireUser, type CurrentUser } from '@/lib/auth/session'
import { can } from '@/lib/authz'
import { leadVisibilityFilter } from '@/lib/visibility'
import { PERMISSIONS } from '@/lib/permissions'
import { prisma } from '@/lib/db'
import { currencySymbol } from '@/lib/settings'
import { formatMoney } from '@/lib/format'
import { formatCounterDate } from '@/lib/prospecting/dates'
import { counterTotals, formatRate, rate } from '@/lib/prospecting/metrics'
import { reachedByCommonStage, reachedByVertical } from '@/lib/reports/aggregate'
import {
  analyticsQuery,
  leadListHref,
  peopleScopeOf,
  PIPELINE_STAGES,
  resolveDashboard,
} from '@/lib/reports/filters'
import {
  conversion,
  leadCounts,
  leadCountsByVertical,
  pipelineValue,
  revenueTotals,
} from '@/lib/reports/kpis'
import {
  filterOptions,
  leadTriggerLabel,
  leadTriggerMetric,
  verticalsWithStages,
} from '@/lib/reports/options'
import { COMMON_STAGE_LABELS } from '@/lib/leads/display'
import { ROLE_LABELS } from '@/lib/roles'
import { AnalyticsFilterBar } from '@/components/analytics-filters'
import { Bars, type Bar } from '@/components/charts/bars'
import { Donut, type Slice } from '@/components/charts/donut'
import { ExportButtons } from '@/components/export-buttons'
import { ButtonLink } from '@/components/ui/button'
import { Card, EmptyState, PageHeader } from '@/components/ui/page'
import { Stat, StatRow } from '@/components/ui/stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'

export const metadata = { title: 'Dashboard · Sales CRM' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const number = (value: number) => value.toLocaleString('en-GB')

/**
 * The dashboard (README §24–§26, docs/03 §1) — the screen the whole application
 * is for. README §40's success test is that the Sales Head stops using
 * spreadsheets, and this is the page that has to replace them.
 *
 * Four panels, exactly as the flowchart draws them: the KPI row, Leads by
 * Vertical, Conversion by Vertical, and the Pipeline Overview across the common
 * stages. Above them the global filter bar; behind every number a link that
 * applies the same filters to the lead list (README §37).
 *
 * **Role-aware without a second implementation.** There is no "BDE dashboard" —
 * there is one dashboard and one scope rule: an Admin sees the company, and
 * everybody else sees only the leads they generated or own. That is deliberately
 * narrower than a BDM's data scope, which still covers their reporting sub-tree
 * everywhere else in the app. This page answers "how am I doing", not "how is
 * my team doing". `resolveDashboard` is where the rule lives, the header says
 * whose leads are being counted, and every tile links through with `mine=1` so
 * the list it opens contains exactly the rows behind the number.
 *
 * The revenue cards are the one thing that is genuinely gated rather than
 * scoped: `report.revenue` is a permission a BDE does not hold, and half a row of
 * cards is better than money figures shown to somebody who should not see them.
 *
 * **The three date rules are on the page**, not only in the code. Counts are the
 * creation cohort, revenue flows are dated by the event that booked them, and
 * pipeline is as at today — see `src/lib/reports/kpis.ts`. A card that visibly
 * ignores the date filter reads as a bug unless the screen says otherwise.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await requireUser()
  const params = await searchParams

  const [canSeeLeads, canSeeRevenue, canSeeReports, canExport] =
    await Promise.all([
      can(viewer, PERMISSIONS.LEAD_VIEW),
      can(viewer, PERMISSIONS.REPORT_REVENUE),
      can(viewer, PERMISSIONS.REPORT_VIEW),
      can(viewer, PERMISSIONS.DATA_EXPORT),
    ])

  // Someone with no lead access has nothing to aggregate. Rare — every seeded
  // role holds it — but a role stripped of it in /admin/permissions should get
  // an explanation rather than a row of zeroes that look like a data problem.
  if (!canSeeLeads) {
    return (
      <div className="space-y-5">
        <PageHeader
          title={`Welcome, ${viewer.name}`}
          description={ROLE_LABELS[viewer.role]}
        />
        <EmptyState>
          Your role does not include lead visibility, so there is nothing to
          summarise here. Prospecting counters are still yours to log.
        </EmptyState>
      </div>
    )
  }

  // Narrower than the role's data scope on purpose: this page answers "how am
  // I doing", so a BDM counts only leads they generated or own even though the
  // lead list and the reports still show their sub-tree's. See resolveDashboard.
  const scope = await resolveDashboard(viewer, params)

  // The cross-vertical breakdowns are the administrator view. A BDM or BDE
  // dashboard answers "how am I doing", and a table with a row for every
  // vertical in the company answers a different question — one their own
  // numbers cannot even fill in, because every vertical they do not work is
  // structurally zero for them. Keyed off `scope.ownOnly` rather than the role
  // directly, so this and the narrowing that produced it cannot drift apart.
  const showByVertical = !scope.ownOnly

  const [counts, pipelineStages, pipeline, options, symbol] = await Promise.all([
    leadCounts(scope),
    reachedByCommonStage(scope),
    pipelineValue(scope),
    filterOptions(viewer, scope.visible),
    currencySymbol(),
  ])

  // Four reads nothing else on the page uses, so they are not run for the
  // people who will not see them — which is everybody but an administrator.
  // `counterTotals` is the "input" column of Conversion by Vertical, and only
  // the lead-trigger metric of each vertical: the last count before a Lead
  // exists (open question Q1, now a per-metric checkbox in Master Data).
  const breakdown = showByVertical
    ? await (async () => {
        const [byVertical, verticals, reachedWon, counters] = await Promise.all([
          leadCountsByVertical(scope),
          verticalsWithStages(),
          reachedByVertical(scope, 'WON'),
          counterTotals(scope.range, peopleScopeOf(scope), scope.verticalId),
        ])
        return { byVertical, verticals, reachedWon, counters }
      })()
    : null

  const revenue = canSeeRevenue ? await revenueTotals(scope) : null

  const slices: Slice[] = (breakdown?.verticals ?? [])
    .map((vertical) => ({
      key: vertical.id,
      label: vertical.name,
      value: breakdown?.byVertical.get(vertical.id)?.total ?? 0,
      href: leadListHref(scope, { vertical: vertical.id }),
    }))
    .sort((a, b) => b.value - a.value)

  const stageBars: Bar[] = PIPELINE_STAGES.map((stage) => ({
    key: stage,
    label: COMMON_STAGE_LABELS[stage],
    value: pipelineStages.get(stage) ?? 0,
    href: leadListHref(scope, { stage }),
    tone: stage === 'WON' ? 'won' : stage === 'LOST' ? 'lost' : 'default',
  }))

  const query = analyticsQuery({
    ...scope.filters,
    from: scope.range.fromKey,
    to: scope.range.toKey,
  })

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        description={`${ROLE_LABELS[viewer.role]} view — ${scopeSentence(viewer.role)}`}
        actions={
          <div className="flex gap-2">
            {canSeeReports ? (
              <ButtonLink href={`/reports?${query}`} variant="secondary">
                All reports
              </ButtonLink>
            ) : null}
            {canExport ? (
              <ExportButtons report="dashboard" query={query} />
            ) : null}
          </div>
        }
      />

      <AnalyticsFilterBar
        action="/"
        filters={scope.filters}
        from={scope.range.fromKey}
        to={scope.range.toKey}
        options={options}
      />

      <p className="text-xs text-slate-500">
        {formatCounterDate(scope.range.from)} to{' '}
        {formatCounterDate(scope.range.to)}
        {scope.filters.from || scope.filters.to
          ? ''
          : ' (default — the last five weeks)'}
        . Counts are leads <strong>created</strong> in this window, so the four
        below add up to Total. Revenue is dated by when it was booked, and
        Pipeline is as at today — neither of those two moves with the date filter
        in the same way.
      </p>

      <StatRow>
        <Stat
          label="Total leads"
          value={number(counts.total)}
          hint="Created in this period"
          href={leadListHref(scope)}
        />
        <Stat
          label="Open"
          value={number(counts.open)}
          hint="Still in play"
          href={leadListHref(scope, { status: 'OPEN' })}
        />
        <Stat
          label="Won"
          value={number(counts.won)}
          hint="Of this period's leads"
          href={leadListHref(scope, { status: 'WON' })}
        />
        <Stat
          label="Lost"
          value={number(counts.lost)}
          hint="Of this period's leads"
          href={leadListHref(scope, { status: 'LOST' })}
        />
      </StatRow>

      <StatRow>
        <Stat
          label="Overall conversion"
          value={formatRate(conversion(counts))}
          hint="Won ÷ (won + lost) — both lead counts"
        />
        {canSeeRevenue && revenue ? (
          <>
            <Stat
              label="Won revenue"
              value={formatMoney(revenue.totals.won, symbol)}
              hint="Booked in this period — deal value, or placements for Staffing"
            />
            <Stat
              label="Collected"
              value={formatMoney(revenue.totals.collected, symbol)}
              hint="Payments received in this period"
            />
            <Stat
              label="Pending"
              value={formatMoney(revenue.totals.pending, symbol)}
              hint={
                revenue.totals.overdue > 0
                  ? `${formatMoney(revenue.totals.overdue, symbol)} of it overdue — as at today`
                  : 'Outstanding on live invoices, as at today'
              }
              href="/invoices"
            />
          </>
        ) : (
          <Stat
            label="Pipeline value"
            value={formatMoney(pipeline.total, symbol)}
            hint={`${number(pipeline.leads)} open leads, at deal value or expected budget`}
          />
        )}
      </StatRow>

      {canSeeRevenue ? (
        <StatRow>
          <Stat
            label="Pipeline value"
            value={formatMoney(pipeline.total, symbol)}
            hint={`${number(pipeline.leads)} open leads, at deal value or expected budget`}
          />
          <Stat
            label="Invoiced"
            value={formatMoney(revenue?.totals.invoiced ?? 0, symbol)}
            hint="Raised on live invoices, all dates"
            tone="muted"
          />
          <Stat
            label="Collected + pending"
            value={formatMoney(
              (revenue?.totals.collected ?? 0) + (revenue?.totals.pending ?? 0),
              symbol,
            )}
            hint="Reconciles to Won Revenue where every won deal has been invoiced (Q11)"
            tone="muted"
          />
          <Stat
            label="Overdue"
            value={formatMoney(revenue?.totals.overdue ?? 0, symbol)}
            hint="Past its due date and still owing"
            href="/invoices?status=OVERDUE"
            tone="muted"
          />
        </StatRow>
      ) : null}

      {breakdown ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card
            title="Leads by vertical"
            description="Share of the leads created in this period. Every slice opens the list behind it."
          >
            <Donut slices={slices} total={counts.total} />
          </Card>

          <Card
            title="Pipeline overview"
            description="Leads that passed through each common stage in this period (decision D12) — not leads sitting there now, so the bars do not sum to Total."
          >
            <Bars bars={stageBars} />
          </Card>
        </div>
      ) : (
        // Alone, so it takes the full width rather than leaving half a row
        // empty where the vertical donut used to be.
        <Card
          title="Pipeline overview"
          description="Your leads that passed through each common stage in this period (decision D12) — not leads sitting there now, so the bars do not sum to Total."
        >
          <Bars bars={stageBars} />
        </Card>
      )}

      {breakdown ? (
      <Card
        title="Conversion by vertical"
        description="The input above the line, the leads below it, and what came out. The input column is each vertical's lead-trigger counter — the one Master Data marks as the last count before a lead exists."
        actions={
          canSeeReports ? (
            <ButtonLink
              href={`/reports/vertical?${query}`}
              variant="secondary"
              size="sm"
            >
              Full comparison
            </ButtonLink>
          ) : undefined
        }
      >
        {breakdown.verticals.length === 0 ? (
          <EmptyState>
            No active verticals. An administrator can restore them in Master
            Data.
          </EmptyState>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Vertical</TH>
                <TH>Input metric</TH>
                <TH className="text-right">Input</TH>
                <TH className="text-right">Leads</TH>
                <TH className="text-right">Won</TH>
                <TH className="text-right">Conversion</TH>
              </TR>
            </THead>
            <TBody>
              {breakdown.verticals.map((vertical) => {
                const trigger = leadTriggerMetric(vertical.metrics)
                const input = trigger.metric
                  ? (breakdown.counters.get(trigger.metric.id) ?? 0)
                  : null
                const leads = breakdown.byVertical.get(vertical.id)?.total ?? 0
                const won = breakdown.reachedWon.get(vertical.id) ?? 0

                return (
                  <TR key={vertical.id}>
                    <TD className="font-medium text-slate-900">
                      <a
                        href={leadListHref(scope, { vertical: vertical.id })}
                        className="hover:underline"
                      >
                        {vertical.name}
                      </a>
                    </TD>
                    {/* Product Sales and Other Sources have no counters by
                        design (docs/02 §2) — the inquiry itself is the lead — so
                        this reads as a dash rather than a zero. A vertical that
                        has counters but no lead-trigger checkbox says so, rather
                        than presenting the fallback as a setting. */}
                    <TD className="text-slate-500">
                      {leadTriggerLabel(trigger)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {input === null ? '—' : number(input)}
                    </TD>
                    <TD className="text-right tabular-nums">{number(leads)}</TD>
                    <TD className="text-right tabular-nums">{number(won)}</TD>
                    <TD className="text-right tabular-nums">
                      {/* Won ÷ leads created, both in this period. Not the KPI
                          row's Won ÷ (won + lost): this column is about how much
                          of the intake converted, which is the question a
                          vertical comparison answers. */}
                      {formatRate(rate(won, leads))}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </Card>
      ) : null}

      {canSeeRevenue && revenue && breakdown ? (
        <Card
          title="Revenue by vertical"
          description="Won in this period, against what has been collected and what is still owed. Won and Collected are flows; Pending is as at today."
          actions={
            <ButtonLink
              href={`/reports/revenue?${query}`}
              variant="secondary"
              size="sm"
            >
              Revenue report
            </ButtonLink>
          }
        >
          <Bars
            bars={breakdown.verticals
              .map((vertical) => {
                const money = revenue.byVertical.get(vertical.id)
                return {
                  key: vertical.id,
                  label: vertical.name,
                  value: Math.round(money?.won ?? 0),
                  note: formatMoney(money?.collected ?? 0, symbol),
                  href: leadListHref(scope, {
                    vertical: vertical.id,
                    status: 'WON',
                  }),
                } satisfies Bar
              })
              .sort((a, b) => b.value - a.value)}
            emptyLabel="No revenue booked in this period."
          />
          <p className="mt-3 text-xs text-slate-500">
            The figure on the right of each bar is what has been collected
            against that vertical in the same period.
          </p>
        </Card>
      ) : null}

      <FollowUps viewer={viewer} />
    </div>
  )
}

/**
 * Whose leads this page is counting, in one clause.
 *
 * Not the role's data scope: the dashboard is narrower than that for everyone
 * but an Admin, so this says what the numbers are rather than what the role may
 * reach. A BDM whose lead list shows their whole sub-tree needs the header to
 * explain why the dashboard total is smaller.
 */
function scopeSentence(role: string): string {
  return role === 'ADMIN'
    ? 'every lead in the company'
    : 'only the leads you generated or own'
}

/**
 * The one thing on this page that is not an aggregate.
 *
 * A dashboard that answers "how is the quarter going" and nothing else gets
 * opened weekly. The follow-up counts are what make it worth opening daily, and
 * they are the same two queries the lead list's own follow-up filter runs, so the
 * numbers and the list they link to cannot disagree.
 */
async function FollowUps({ viewer }: { viewer: CurrentUser }) {
  // The data scope, applied here as everywhere: without it a BDE would be shown
  // the company's overdue count and then follow the link to a list of their own
  // three, which is both a leak and a screen that contradicts itself.
  const visibility = await leadVisibilityFilter(viewer)

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  )

  const [overdue, today] = await Promise.all([
    prisma.lead.count({
      where: {
        isDeleted: false,
        status: 'OPEN',
        nextFollowUpAt: { lt: startOfToday },
        AND: [visibility],
      },
    }),
    prisma.lead.count({
      where: {
        isDeleted: false,
        status: 'OPEN',
        nextFollowUpAt: { gte: startOfToday, lte: endOfToday },
        AND: [visibility],
      },
    }),
  ])

  if (overdue === 0 && today === 0) return null

  return (
    <Card
      title="Follow-ups"
      description="Open leads with a follow-up date that has arrived. Not filtered by the bar above — a chase is due whatever period the report is showing."
    >
      <StatRow>
        <Stat
          label="Overdue"
          value={number(overdue)}
          hint="Follow-up date has passed"
          href="/leads?follow=overdue"
        />
        <Stat
          label="Due today"
          value={number(today)}
          hint="On the list for today"
          href="/leads?follow=today"
        />
      </StatRow>
    </Card>
  )
}
