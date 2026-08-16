import 'server-only'

import { prisma } from '@/lib/db'
import { rate } from '@/lib/prospecting/metrics'
import {
  localDayStart,
  type PeopleScope,
  type ResolvedRange,
} from '@/lib/prospecting/filters'
import { addDays } from '@/lib/prospecting/dates'

/**
 * The Staffing metrics of docs/02-funnels-and-metrics.md §4.7.
 *
 * Counts come from three tables, and `subReached(CODE)` is the
 * candidate-submission equivalent of the lead-level `reached()` in
 * `src/lib/prospecting/metrics.ts`: it counts submissions that **ever passed
 * through** a stage, read from `CandidateStageHistory`, not submissions sitting
 * there now (decision D12). A profile that went Shared → Shortlisted →
 * Interview counts once in each of those three, which is why the funnel cannot
 * be read off `CandidateSubmission.currentStageId` and why a step's number can
 * exceed the number of people currently near it.
 *
 * **Stage codes appear here and nowhere else in the staffing code.** That is a
 * deliberate exception to the rule the funnel builder follows: §4.7 defines its
 * metrics *by* code — "Profiles Shared = subReached(PROFILE_SHARED)" — so a
 * report reproducing that table has to name them. Everything reads through
 * `byCode`, which returns zero for a code an administrator has removed rather
 * than throwing, so a renamed stage list degrades to a blank row instead of a
 * broken screen. The requirement funnel below is assembled from master data in
 * the usual way and names nothing.
 */

/** The codes §4.7 names. Kept together so the exception above is one list. */
export const CANDIDATE_STAGE_CODES = {
  profileShared: 'PROFILE_SHARED',
  shortlisted: 'SHORTLISTED',
  interviewScheduled: 'INTERVIEW_SCHEDULED',
  interviewCompleted: 'INTERVIEW_COMPLETED',
  selected: 'SELECTED',
} as const

export const REQUIREMENT_STAGE_CODES = {
  qualified: 'REQUIREMENT_QUALIFIED',
} as const

/**
 * Requirement-side scope, mirroring `leadStageScope` in the prospecting
 * metrics: only the people filters carry over, because a history row is dated
 * by its own `changedAt` rather than by when the requirement was raised.
 */
function requirementScope(people: PeopleScope) {
  return {
    isDeleted: false,
    ...(people.only ? { assignedToId: people.only } : {}),
    ...(people.teamId ? { lead: { teamId: people.teamId } } : {}),
    ...(people.visible
      ? {
          OR: [
            { assignedToId: { in: people.visible } },
            { lead: { generatedById: { in: people.visible } } },
            { lead: { assignedToId: { in: people.visible } } },
          ],
        }
      : {}),
  }
}

/** The half-open instant range a calendar-day range covers, in local time. */
function instants(range: ResolvedRange) {
  return {
    gte: localDayStart(range.from),
    lt: localDayStart(addDays(range.to, 1)),
  }
}

/** Requirements raised in the period, and their openings. */
export async function requirementTotals(
  range: ResolvedRange,
  people: PeopleScope,
) {
  const where = { ...requirementScope(people), createdAt: instants(range) }

  const [aggregate, byStatus] = await Promise.all([
    prisma.requirement.aggregate({
      where,
      _count: { _all: true },
      _sum: { openings: true, positionsFilled: true },
    }),
    prisma.requirement.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    }),
  ])

  const counts = new Map(byStatus.map((row) => [row.status, row._count._all]))

  return {
    received: aggregate._count._all,
    openings: aggregate._sum.openings ?? 0,
    positionsFilled: aggregate._sum.positionsFilled ?? 0,
    filled: (counts.get('FILLED') ?? 0) + (counts.get('PARTIALLY_FILLED') ?? 0),
    lost: counts.get('LOST') ?? 0,
    cancelled: counts.get('CANCELLED') ?? 0,
    open: counts.get('OPEN') ?? 0,
    onHold: counts.get('ON_HOLD') ?? 0,
  }
}

/**
 * `reached()` for requirement stages — the same shape as the lead-level one,
 * scoped by when the transition happened rather than when the requirement was
 * raised, because "how far did the pipeline move this month" is the question a
 * funnel answers.
 */
export async function requirementReachedByStage(
  range: ResolvedRange,
  people: PeopleScope,
): Promise<Map<string, number>> {
  const rows = await prisma.requirementStageHistory.findMany({
    where: {
      changedAt: instants(range),
      requirement: requirementScope(people),
    },
    select: { toStageId: true, requirementId: true },
    distinct: ['toStageId', 'requirementId'],
  })

  const counts = new Map<string, number>()
  for (const row of rows) {
    counts.set(row.toStageId, (counts.get(row.toStageId) ?? 0) + 1)
  }
  return counts
}

/**
 * `subReached()` — submissions that ever reached each candidate stage.
 *
 * Same read-and-count-in-memory shape as `reached()`, and the same caveat
 * carried forward from Phase 3: correct and indexed on the transition date, but
 * a read of every history row in the period rather than a `GROUP BY`. The
 * obvious thing to convert when Phase 6 runs these for eight verticals at once.
 */
export async function subReachedByStage(
  range: ResolvedRange,
  people: PeopleScope,
): Promise<Map<string, number>> {
  const rows = await prisma.candidateStageHistory.findMany({
    where: {
      changedAt: instants(range),
      submission: { requirement: requirementScope(people) },
    },
    select: { toStageId: true, submissionId: true },
    distinct: ['toStageId', 'submissionId'],
  })

  const counts = new Map<string, number>()
  for (const row of rows) {
    counts.set(row.toStageId, (counts.get(row.toStageId) ?? 0) + 1)
  }
  return counts
}

/** Distinct people put forward in the period — Candidates Sourced. */
export async function candidatesSourced(
  range: ResolvedRange,
  people: PeopleScope,
): Promise<number> {
  const rows = await prisma.candidateSubmission.findMany({
    where: {
      submittedAt: instants(range),
      requirement: requirementScope(people),
    },
    select: { candidateId: true },
    distinct: ['candidateId'],
  })

  return rows.length
}

/** Interview rounds scheduled in the period, and placements that joined in it. */
export async function interviewAndPlacementTotals(
  range: ResolvedRange,
  people: PeopleScope,
) {
  const [interviews, placements] = await Promise.all([
    prisma.interview.count({
      where: {
        scheduledAt: instants(range),
        submission: { requirement: requirementScope(people) },
      },
    }),
    prisma.placement.aggregate({
      where: {
        joiningDate: instants(range),
        requirement: requirementScope(people),
      },
      _count: { _all: true },
      _sum: { placementValue: true },
    }),
  ])

  return {
    interviews,
    placements: placements._count._all,
    placementValue: placements._sum.placementValue,
  }
}

/**
 * The two "requirements with at least one X" figures §4.7 asks for.
 *
 * Not derivable from `subReached`, which counts submissions: five profiles
 * shared against one requirement is five for Profiles Shared and one here. The
 * distinction is the whole point of Requirement → Profile Shared %, which asks
 * how many roles we actually responded to rather than how much we sent.
 */
export async function requirementsWithActivity(
  range: ResolvedRange,
  people: PeopleScope,
  profileSharedStageId: string | null,
) {
  const where = { ...requirementScope(people), createdAt: instants(range) }

  const [withPlacement, withProfileShared] = await Promise.all([
    prisma.requirement.count({
      where: { ...where, placements: { some: {} } },
    }),
    profileSharedStageId
      ? prisma.requirement.count({
          where: {
            ...where,
            submissions: {
              some: {
                stageHistory: { some: { toStageId: profileSharedStageId } },
              },
            },
          },
        })
      : Promise.resolve(0),
  ])

  return { withPlacement, withProfileShared }
}

/**
 * Look a stage id up by code, tolerating a list an administrator has edited.
 *
 * Returns `null` for a missing code, which every caller turns into a zero. A
 * report that threw because someone renamed `SELECTED` would be a report that
 * punished the configurability the rest of the system is built on.
 */
export function byCode(
  stages: Array<{ id: string; code: string }>,
  code: string,
): string | null {
  return stages.find((stage) => stage.code === code)?.id ?? null
}

/** `subReached` for a code, or 0 when the stage is not in the list. */
export function reachedFor(
  counts: Map<string, number>,
  stages: Array<{ id: string; code: string }>,
  code: string,
): number {
  const id = byCode(stages, code)
  return id ? (counts.get(id) ?? 0) : 0
}

export { rate }
