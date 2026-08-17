import 'server-only'

import { prisma } from '@/lib/db'
import { daysBetween } from '@/lib/format'
import { averageHoursByStage } from '@/lib/reports/aggregate'
import { openPipelineWhere, type AnalyticsScope } from '@/lib/reports/filters'
import { verticalsWithStages } from '@/lib/reports/options'
import { toCents, fromCents } from '@/lib/commercials/money'
import type { CommonStage, Priority } from '@/generated/prisma/enums'

/**
 * Pipeline Aging (README §29, docs/02 §6).
 *
 * Two questions on one screen, and they are not the same question:
 *
 *  - **Which leads are stuck.** `now − Lead.stageChangedAt > agingThresholdDays`,
 *    per stage and per vertical, because a lead may legitimately sit in
 *    Negotiation far longer than it may sit in Requirement Gathering. The
 *    threshold is master data, so this is a comparison against each lead's *own*
 *    limit rather than one number for the company.
 *  - **Which stages are slow.** `AVG(hoursInPreviousStage) GROUP BY fromStageId`
 *    — the bottleneck view, over stays that have actually ended.
 *
 * The per-stage threshold is also why this cannot be filtered in SQL: "past its
 * own threshold" is a comparison between a row and a column of another table,
 * and Prisma has no way to express it. So the open pipeline is read and compared
 * in memory, which is the same trade the requirement list made in Phase 4 — the
 * difference being that this screen shows the real per-stage threshold on every
 * row rather than approximating it with "not moved in 14 days".
 */

/**
 * A cap on the read, not a page size. It is far past the assumed open pipeline
 * (open question Q5) and exists so that a mis-scoped render cannot pull the
 * whole lead table into memory. The screen says when it bit.
 */
export const AGING_LIMIT = 1_000

export type AgingLead = {
  id: string
  leadCode: string
  title: string
  client: string
  vertical: string
  stage: string | null
  commonStage: CommonStage
  owner: string | null
  generatedBy: string
  priority: Priority
  days: number
  threshold: number | null
  /** Days past the threshold. Null when the stage has no threshold set. */
  over: number | null
  value: number
}

export type StageBottleneck = {
  stageId: string
  stage: string
  vertical: string
  hours: number
  transitions: number
}

export type AgingReport = {
  leads: AgingLead[]
  /** Every open lead in scope, flagged or not — the denominator. */
  openLeads: number
  flagged: number
  truncated: boolean
  /** Flagged leads and their value, per common stage. */
  byStage: Array<{ stage: CommonStage; flagged: number; total: number; value: number }>
  bottlenecks: StageBottleneck[]
  /** Stages with no threshold configured, so the screen can say why nothing flagged. */
  stagesWithoutThreshold: string[]
}

export async function loadAging(scope: AnalyticsScope): Promise<AgingReport> {
  const [leads, verticals, averages] = await Promise.all([
    prisma.lead.findMany({
      where: openPipelineWhere(scope),
      select: {
        id: true,
        leadCode: true,
        title: true,
        priority: true,
        stageChangedAt: true,
        commonStage: true,
        dealValue: true,
        expectedBudget: true,
        client: { select: { clientName: true } },
        vertical: { select: { name: true } },
        currentStage: {
          select: { name: true, agingThresholdDays: true },
        },
        assignedTo: { select: { name: true } },
        generatedBy: { select: { name: true } },
      },
      // Oldest first: the report's whole purpose is the top of this list.
      orderBy: { stageChangedAt: 'asc' },
      take: AGING_LIMIT + 1,
    }),
    verticalsWithStages(),
    averageHoursByStage(scope),
  ])

  const truncated = leads.length > AGING_LIMIT
  const rows = truncated ? leads.slice(0, AGING_LIMIT) : leads

  const mapped: AgingLead[] = rows.map((lead) => {
    const days = daysBetween(lead.stageChangedAt)
    const threshold = lead.currentStage?.agingThresholdDays ?? null

    return {
      id: lead.id,
      leadCode: lead.leadCode,
      title: lead.title,
      client: lead.client.clientName,
      vertical: lead.vertical.name,
      stage: lead.currentStage?.name ?? null,
      commonStage: lead.commonStage,
      owner: lead.assignedTo?.name ?? null,
      generatedBy: lead.generatedBy.name,
      priority: lead.priority,
      days,
      threshold,
      over: threshold === null ? null : days - threshold,
      value: fromCents(toCents(lead.dealValue ?? lead.expectedBudget)),
    }
  })

  const flaggedLeads = mapped.filter((lead) => lead.over !== null && lead.over > 0)

  const byStage = new Map<
    CommonStage,
    { flagged: number; total: number; value: number }
  >()

  for (const lead of mapped) {
    const bucket =
      byStage.get(lead.commonStage) ?? { flagged: 0, total: 0, value: 0 }
    bucket.total += 1
    if (lead.over !== null && lead.over > 0) {
      bucket.flagged += 1
      bucket.value += lead.value
    }
    byStage.set(lead.commonStage, bucket)
  }

  // Stage names for the bottleneck table come from master data, so a renamed
  // stage renames itself here as it does everywhere else.
  const stageNames = new Map<string, { name: string; vertical: string }>()
  const withoutThreshold: string[] = []

  for (const vertical of verticals) {
    for (const stage of vertical.stages) {
      stageNames.set(stage.id, { name: stage.name, vertical: vertical.name })
      if (
        stage.agingThresholdDays === null &&
        !stage.isWon &&
        !stage.isLost
      ) {
        withoutThreshold.push(`${vertical.name} — ${stage.name}`)
      }
    }
  }

  const bottlenecks: StageBottleneck[] = [...averages]
    .map(([stageId, value]) => ({
      stageId,
      stage: stageNames.get(stageId)?.name ?? 'Retired stage',
      vertical: stageNames.get(stageId)?.vertical ?? '—',
      hours: value.hours,
      transitions: value.transitions,
    }))
    .sort((a, b) => b.hours - a.hours)

  return {
    leads: flaggedLeads,
    openLeads: mapped.length,
    flagged: flaggedLeads.length,
    truncated,
    byStage: [...byStage]
      .map(([stage, bucket]) => ({ stage, ...bucket }))
      .sort((a, b) => b.flagged - a.flagged),
    bottlenecks,
    stagesWithoutThreshold: withoutThreshold,
  }
}
