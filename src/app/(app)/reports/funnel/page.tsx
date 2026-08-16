import { prisma } from '@/lib/db'
import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import {
  pickReportFilters,
  resolvePeople,
  resolveRange,
} from '@/lib/prospecting/filters'
import {
  buildFunnel,
  counterTotals,
  formatRate,
  leadsCreatedByVertical,
  rate,
  reachedByStage,
} from '@/lib/prospecting/metrics'
import { loggablePeople } from '@/lib/prospecting/people'
import { formatCounterDate } from '@/lib/prospecting/dates'
import { AccessDenied } from '@/components/access-denied'
import { FunnelSteps } from '@/components/funnel-steps'
import { ReportFilterBar } from '@/components/report-filters'
import { ButtonLink } from '@/components/ui/button'
import { Card, EmptyState, PageHeader } from '@/components/ui/page'
import { Stat, StatRow } from '@/components/ui/stat'

export const metadata = { title: 'Vertical funnel · Sales CRM' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const number = (value: number) => value.toLocaleString('en-GB')

/**
 * The vertical funnel (docs/03 §1, docs/02 §4).
 *
 * Both halves of decision D1 on one screen: the counters somebody typed above
 * the line, the bridge across it, and `reached()` down the stage list below.
 * Every step and every percentage is derived from the vertical's own master
 * data — see `buildFunnel` — so renaming a stage renames it here, and adding a
 * ninth vertical gives it a funnel with no code change.
 *
 * Two things the numbers mean, stated on the page as well as here because they
 * are the two people get wrong:
 *
 *  - A stage count is leads that *ever passed through* it in the period
 *    (decision D12), not leads sitting there now. Sums down the column will not
 *    match the lead list's stage filter, and should not.
 *  - The counter half is dated by the day the work was logged; the stage half
 *    is dated by the day the transition happened. A deal created in June and
 *    won in August belongs to August here.
 */
export default async function FunnelReportPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.REPORT_VIEW)
  if (!viewer) return <AccessDenied what="reports" />

  const filters = pickReportFilters(await searchParams)
  const range = resolveRange(filters)
  const people = await resolvePeople(viewer, filters)

  const verticals = await prisma.salesVertical.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      metrics: {
        where: { isActive: true },
        select: { id: true, key: true, label: true, isLeadTrigger: true },
        orderBy: { sortOrder: 'asc' },
      },
      stages: {
        where: { isActive: true },
        select: { id: true, code: true, name: true, isWon: true, isLost: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
    orderBy: { sortOrder: 'asc' },
  })

  if (verticals.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader title="Vertical funnel" />
        <EmptyState>No active verticals.</EmptyState>
      </div>
    )
  }

  const vertical =
    verticals.find((row) => row.id === filters.vertical) ?? verticals[0]

  const [counters, leadsByVertical, reached, staff, teams] = await Promise.all([
    counterTotals(range, people, vertical.id),
    leadsCreatedByVertical(range, people, vertical.id),
    reachedByStage(range, people, vertical.id),
    loggablePeople(viewer),
    prisma.team.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  const funnel = buildFunnel(
    vertical,
    counters,
    leadsByVertical.get(vertical.id) ?? 0,
    reached,
  )

  const lostStage = vertical.stages.find((stage) => stage.isLost)
  const wonStage = vertical.stages.find((stage) => stage.isWon)
  const lost = lostStage ? (reached.get(lostStage.id) ?? 0) : 0
  const won = wonStage ? (reached.get(wonStage.id) ?? 0) : 0

  // One scale for every bar on the page, so the drop at the line is visible.
  const max = Math.max(
    1,
    ...funnel.above.map((step) => step.value),
    funnel.bridge?.value ?? 0,
    ...funnel.below.map((step) => step.value),
  )

  // `people.only` rather than the raw `user` parameter, so the list this links
  // to is filtered by exactly what the number was computed from — see the same
  // note on the counter summary.
  const leadListQuery = new URLSearchParams({
    vertical: vertical.id,
    from: range.fromKey,
    to: range.toKey,
    ...(people.only ? { bde: people.only } : {}),
    ...(filters.team ? { team: filters.team } : {}),
  }).toString()

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${vertical.name} funnel`}
        description="Counters above the line, leads below it, and the conversion at every step."
        actions={
          <ButtonLink href="/prospecting/summary" variant="secondary">
            Counter summary
          </ButtonLink>
        }
      />

      <ReportFilterBar
        action="/reports/funnel"
        filters={{ ...filters, vertical: vertical.id }}
        from={range.fromKey}
        to={range.toKey}
        verticals={verticals.map((row) => ({ value: row.id, label: row.name }))}
        verticalLabel={null}
        people={staff.map((row) => ({ value: row.id, label: row.name }))}
        teams={teams.map((row) => ({ value: row.id, label: row.name }))}
      />

      <p className="text-xs text-slate-500">
        {formatCounterDate(range.from)} to {formatCounterDate(range.to)}
        {filters.from || filters.to ? '' : ' (default — the last five weeks)'}
      </p>

      <StatRow>
        <Stat
          label="Leads created"
          value={number(funnel.leadsCreated)}
          hint="In this period"
          href={`/leads?${leadListQuery}`}
        />
        <Stat
          label="Reached Won"
          value={number(won)}
          hint="Leads that reached the winning stage in this period"
        />
        <Stat
          label="Reached Lost"
          value={number(lost)}
          hint="Reported beside the funnel, not inside it"
          tone="muted"
        />
        {/* The fallback turns on whether there *is* an overall step, not on
            whether its conversion came out null. Keying it on the value meant a
            vertical with no counters logged yet fell through to Won ÷ leads
            while the label and hint still read "÷ Pitches Submitted" — a
            different ratio wearing the right one's name. A null conversion is
            an honest em dash. */}
        <Stat
          label={funnel.overall ? funnel.overall.label : 'Conversion'}
          value={formatRate(
            funnel.overall
              ? funnel.overall.conversion
              : rate(won, funnel.leadsCreated),
          )}
          hint={
            funnel.overall
              ? `Won ÷ ${funnel.overall.conversionOf}`
              : 'Won ÷ leads created'
          }
        />
      </StatRow>

      {funnel.above.length > 0 ? (
        <Card
          title="Above the line — prospecting counters"
          description="Daily counts logged by the team. No client record, no lead record (decision D1)."
        >
          <FunnelSteps steps={funnel.above} max={max} />
        </Card>
      ) : (
        <Card
          title="Above the line"
          description="This vertical has no counters by design (docs/02 §2) — the inquiry itself is the lead, so the funnel starts below the line."
        >
          <EmptyState>Nothing is counted above the line here.</EmptyState>
        </Card>
      )}

      {funnel.bridge ? (
        <Card
          title="The bridge"
          description="The one step that crosses the line: how many of those counters turned into an opportunity worth tracking."
        >
          <FunnelSteps steps={[funnel.bridge]} max={max} tone="bridge" />
        </Card>
      ) : null}

      <Card
        title="Below the line — pipeline stages"
        description="Leads that ever passed through each stage in this period (decision D12), not leads sitting there now. A lead counts once in every stage it has been through."
      >
        {funnel.below.length === 0 ? (
          <EmptyState>
            This vertical has no active stages. An administrator can add them
            under Master Data → Stages.
          </EmptyState>
        ) : (
          <FunnelSteps steps={funnel.below} max={max} />
        )}
      </Card>

      <p className="text-xs text-slate-500">
        Counters are dated by the day the work was logged; stages by the day the
        transition happened. A lead created in one month and won in another
        counts in each of them, in the half of the funnel it belongs to.
      </p>
    </div>
  )
}
