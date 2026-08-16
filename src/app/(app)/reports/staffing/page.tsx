import { prisma } from '@/lib/db'
import { can, pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { formatMoney } from '@/lib/format'
import {
  pickReportFilters,
  resolvePeople,
  resolveRange,
} from '@/lib/prospecting/filters'
import { formatRate, rate } from '@/lib/prospecting/metrics'
import { loggablePeople } from '@/lib/prospecting/people'
import { formatCounterDate } from '@/lib/prospecting/dates'
import {
  byCode,
  CANDIDATE_STAGE_CODES,
  candidatesSourced,
  interviewAndPlacementTotals,
  reachedFor,
  REQUIREMENT_STAGE_CODES,
  requirementReachedByStage,
  requirementsWithActivity,
  requirementTotals,
  subReachedByStage,
} from '@/lib/staffing/metrics'
import { AccessDenied } from '@/components/access-denied'
import { FunnelSteps } from '@/components/funnel-steps'
import { ReportFilterBar } from '@/components/report-filters'
import { ButtonLink } from '@/components/ui/button'
import { Card, EmptyState, PageHeader } from '@/components/ui/page'
import { Stat, StatRow } from '@/components/ui/stat'
import type { FunnelStep } from '@/lib/prospecting/metrics'

export const metadata = { title: 'Staffing report · Sales CRM' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const number = (value: number) => value.toLocaleString('en-GB')

/**
 * The staffing report (docs/03 §1, docs/02 §4.7).
 *
 * Three levels on one screen, because that is what Staffing is: requirements
 * received and qualified, profiles sourced and shared, and the interviews,
 * selections and placements that come out the far end.
 *
 * Two things about the numbers, stated on the page as well as here because they
 * are the two people misread:
 *
 *  - **Requirement counts and submission counts are different units.** Five
 *    profiles against one role is 5 for Profiles Shared and 1 for
 *    "requirements with a profile shared". Requirement → Profile Shared % uses
 *    the second, because it asks how many roles we responded to, not how much
 *    we sent.
 *  - **Nothing here is a lead count.** docs/02 §5 is emphatic that requirement
 *    outcomes are reported separately from lead KPIs, because a staffing lead
 *    with two filled requirements is one won lead, not two. This report is
 *    entirely below the lead level.
 *
 * The three date scopes are also deliberately different, and each column header
 * says which it uses: requirements are dated by when they were raised, stage
 * counts by when the transition happened, and placements by when the person
 * actually joined.
 */
export default async function StaffingReportPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.REPORT_VIEW)
  if (!viewer) return <AccessDenied what="reports" />

  const filters = pickReportFilters(await searchParams)
  const range = resolveRange(filters)
  const people = await resolvePeople(viewer, filters)

  const [requirementStages, candidateStages] = await Promise.all([
    prisma.requirementStage.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, isWon: true, isLost: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.candidateStage.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        isPlaced: true,
        isRejected: true,
      },
      orderBy: { sortOrder: 'asc' },
    }),
  ])

  const profileSharedStageId = byCode(
    candidateStages,
    CANDIDATE_STAGE_CODES.profileShared,
  )

  const [
    totals,
    requirementReached,
    subReached,
    sourced,
    outcomes,
    activity,
    peopleOptions,
    teams,
    symbol,
    canSeeRevenue,
  ] = await Promise.all([
    requirementTotals(range, people),
    requirementReachedByStage(range, people),
    subReachedByStage(range, people),
    candidatesSourced(range, people),
    interviewAndPlacementTotals(range, people),
    requirementsWithActivity(range, people, profileSharedStageId),
    loggablePeople(viewer),
    prisma.team.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    currencySymbol(),
    can(viewer, PERMISSIONS.REPORT_REVENUE),
  ])

  const qualifiedId = byCode(requirementStages, REQUIREMENT_STAGE_CODES.qualified)
  const qualified = qualifiedId ? (requirementReached.get(qualifiedId) ?? 0) : 0

  const shared = reachedFor(
    subReached,
    candidateStages,
    CANDIDATE_STAGE_CODES.profileShared,
  )
  const shortlisted = reachedFor(
    subReached,
    candidateStages,
    CANDIDATE_STAGE_CODES.shortlisted,
  )
  const interviewScheduled = reachedFor(
    subReached,
    candidateStages,
    CANDIDATE_STAGE_CODES.interviewScheduled,
  )
  const interviewCompleted = reachedFor(
    subReached,
    candidateStages,
    CANDIDATE_STAGE_CODES.interviewCompleted,
  )
  const selected = reachedFor(
    subReached,
    candidateStages,
    CANDIDATE_STAGE_CODES.selected,
  )

  // The candidate funnel, assembled from the stage list itself so a renamed or
  // reordered list reshapes it. The rejected stage is left out of the chain for
  // the same reason `buildFunnel` leaves Lost out: a profile does not pass
  // *through* rejection on the way to joining, and including it would make the
  // step above divide by the wrong number.
  const chain = candidateStages.filter((stage) => !stage.isRejected)
  const candidateFunnel: FunnelStep[] = chain.map((stage, index) => {
    const value = subReached.get(stage.id) ?? 0
    const previous = index === 0 ? null : chain[index - 1]
    const base = previous ? (subReached.get(previous.id) ?? 0) : sourced

    return {
      key: `cand:${stage.id}`,
      label: stage.name,
      value,
      conversion: rate(value, base),
      conversionOf: previous?.name ?? 'Candidates sourced',
    }
  })

  const requirementChain = requirementStages.filter((stage) => !stage.isLost)
  const requirementFunnel: FunnelStep[] = requirementChain.map((stage, index) => {
    const value = requirementReached.get(stage.id) ?? 0
    const previous = index === 0 ? null : requirementChain[index - 1]
    const base = previous
      ? (requirementReached.get(previous.id) ?? 0)
      : totals.received

    return {
      key: `req:${stage.id}`,
      label: stage.name,
      value,
      conversion: rate(value, base),
      conversionOf: previous?.name ?? 'Requirements received',
    }
  })

  const scale = Math.max(
    sourced,
    totals.received,
    ...candidateFunnel.map((step) => step.value),
    ...requirementFunnel.map((step) => step.value),
    1,
  )

  const nothing =
    totals.received === 0 && sourced === 0 && outcomes.placements === 0

  return (
    <div className="space-y-5">
      <PageHeader
        title="Staffing"
        description="Requirements, openings, profiles, interviews, selections and placements — the three levels of docs/02 §4.7 on one screen."
        // Only the dates carry through. The two lists name their people
        // filters differently — this report's `user` is a report-wide scope,
        // the requirement list's `owner` is the assignee — so passing the whole
        // query string would silently drop or mean the wrong thing. Dates are
        // the part that means the same on both screens.
        actions={
          <ButtonLink
            href={`/requirements?status=all&from=${range.fromKey}&to=${range.toKey}`}
            variant="secondary"
          >
            Open the requirement list
          </ButtonLink>
        }
      />

      <ReportFilterBar
        action="/reports/staffing"
        filters={filters}
        from={range.fromKey}
        to={range.toKey}
        people={peopleOptions.map((person) => ({
          value: person.id,
          label: person.name,
        }))}
        teams={teams.map((team) => ({ value: team.id, label: team.name }))}
      />

      <p className="text-xs text-slate-500">
        {formatCounterDate(range.from)} to {formatCounterDate(range.to)}.
        Requirements are counted by the day they were raised, stage figures by
        the day the transition happened, and placements by the day the person
        joined — so a role raised in June and filled in August appears under
        June here and August there.
      </p>

      {nothing ? (
        <EmptyState>
          Nothing recorded in this period. Raise a requirement under a staffing
          lead, submit candidates to it, and these numbers fill in.
        </EmptyState>
      ) : (
        <>
          <StatRow>
            <Stat
              label="Requirements received"
              value={number(totals.received)}
              hint={`${number(totals.openings)} openings`}
            />
            <Stat
              label="Qualified"
              value={number(qualified)}
              hint={`${formatRate(rate(qualified, totals.received))} of received`}
            />
            <Stat
              label="Candidates sourced"
              value={number(sourced)}
              hint="Distinct people submitted — the same person twice is one"
            />
            <Stat
              label="Fill rate"
              value={formatRate(rate(totals.positionsFilled, totals.openings))}
              hint={`${number(totals.positionsFilled)} of ${number(totals.openings)} openings`}
            />
          </StatRow>

          <StatRow>
            <Stat label="Profiles shared" value={number(shared)} />
            <Stat
              label="Interviews"
              value={number(outcomes.interviews)}
              hint="Rounds scheduled, not people interviewed"
            />
            <Stat
              label="Selections"
              value={number(selected)}
              hint={`${formatRate(rate(selected, interviewCompleted))} of completed interviews`}
            />
            <Stat
              label="Placements"
              value={number(outcomes.placements)}
              hint={
                canSeeRevenue
                  ? `${formatMoney(outcomes.placementValue, symbol)} booked`
                  : `${formatRate(rate(outcomes.placements, selected))} of selections`
              }
              href="/placements"
            />
          </StatRow>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card
              title="Requirement funnel"
              description="How far requirements raised in this period have travelled. Each count is requirements that ever reached that stage, not requirements sitting there now."
            >
              <FunnelSteps steps={requirementFunnel} max={scale} />
            </Card>

            <Card
              title="Candidate funnel"
              description="Submissions that ever reached each stage. Five profiles against one role count five times here — that is the unit."
            >
              {candidateFunnel.length === 0 ? (
                <EmptyState>
                  The candidate stage list is empty. An administrator can
                  restore it in Master Data.
                </EmptyState>
              ) : (
                <FunnelSteps steps={candidateFunnel} max={scale} />
              )}
            </Card>
          </div>

          <Card
            title="Conversions"
            description="The percentages docs/02 §4.7 defines, each with what it divides by. Note that two of them count requirements and the rest count submissions."
          >
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Conversion
                label="Requirement → profile shared"
                value={rate(activity.withProfileShared, totals.received)}
                detail={`${number(activity.withProfileShared)} of ${number(totals.received)} requirements had at least one profile shared`}
              />
              <Conversion
                label="Profiles shared → shortlist"
                value={rate(shortlisted, shared)}
                detail={`${number(shortlisted)} of ${number(shared)} submissions`}
              />
              <Conversion
                label="Shortlist → interview"
                value={rate(interviewScheduled, shortlisted)}
                detail={`${number(interviewScheduled)} of ${number(shortlisted)} submissions`}
              />
              <Conversion
                label="Interview → selection"
                value={rate(selected, interviewCompleted)}
                detail={`${number(selected)} of ${number(interviewCompleted)} completed interviews`}
              />
              <Conversion
                label="Selection → placement"
                value={rate(outcomes.placements, selected)}
                detail={`${number(outcomes.placements)} of ${number(selected)} selections`}
              />
              <Conversion
                label="Requirement → placement"
                value={rate(activity.withPlacement, totals.received)}
                detail={`${number(activity.withPlacement)} of ${number(totals.received)} requirements had at least one placement`}
              />
            </dl>
          </Card>

          <Card
            title="Requirement outcomes"
            description="Counted separately from the lead KPIs, and never added to them: a staffing lead with two filled requirements is one won lead, not two (docs/02 §5)."
          >
            <StatRow>
              <Stat
                label="Filled"
                value={number(totals.filled)}
                hint="Filled and partially filled"
              />
              <Stat label="Lost" value={number(totals.lost)} />
              <Stat
                label="Requirement conversion"
                value={formatRate(rate(totals.filled, totals.filled + totals.lost))}
                hint="Filled ÷ (filled + lost)"
              />
              <Stat
                label="Still live"
                value={number(totals.open + totals.onHold)}
                hint={
                  totals.cancelled > 0
                    ? `${number(totals.cancelled)} cancelled, which is not the same as lost`
                    : `${number(totals.onHold)} on hold`
                }
                tone="muted"
              />
            </StatRow>
          </Card>
        </>
      )}
    </div>
  )
}

function Conversion({
  label,
  value,
  detail,
}: {
  label: string
  value: number | null
  detail: string
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
        {formatRate(value)}
      </dd>
      <p className="mt-0.5 text-xs text-slate-500">{detail}</p>
    </div>
  )
}
