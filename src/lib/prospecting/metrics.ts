import 'server-only'

import { prisma } from '@/lib/db'
import {
  counterWhere,
  leadWhereForPeriod,
  type PeopleScope,
  type ResolvedRange,
} from '@/lib/prospecting/filters'
import { reachedByStageAggregate } from '@/lib/reports/aggregate'

/**
 * The two primitives of docs/02-funnels-and-metrics.md §4, and the funnel each
 * vertical draws out of them.
 *
 *   counter(v, KEY)  = SUM(ProspectingActivity.count)
 *   reached(v, CODE) = COUNT(DISTINCT leadId) FROM LeadStageHistory
 *
 * `reached()` counts leads that **ever passed through** a stage, not leads
 * sitting there now (decision D12). A lead that went Requirement Gathering →
 * Negotiation → Won counts once in each of those three. That is why the funnel
 * cannot be read off `Lead.currentStageId`, and why a stage's number can exceed
 * the number of leads currently anywhere near it.
 */

/** `SUM(count)` per metric, for the metrics of one vertical (or all of them). */
export async function counterTotals(
  range: ResolvedRange,
  people: PeopleScope,
  verticalId?: string | null,
): Promise<Map<string, number>> {
  const rows = await prisma.prospectingActivity.groupBy({
    by: ['metricId'],
    where: counterWhere(range, people, verticalId),
    _sum: { count: true },
  })

  return new Map(rows.map((row) => [row.metricId, row._sum.count ?? 0]))
}

/** Leads created in the period, per vertical. */
export async function leadsCreatedByVertical(
  range: ResolvedRange,
  people: PeopleScope,
  verticalId?: string | null,
): Promise<Map<string, number>> {
  const rows = await prisma.lead.groupBy({
    by: ['verticalId'],
    where: leadWhereForPeriod(range, people, verticalId),
    _count: { _all: true },
  })

  return new Map(rows.map((row) => [row.verticalId, row._count._all]))
}

/**
 * `reached()` for every stage of one vertical.
 *
 * Scoped by *when the transition happened*, not by when the lead was created —
 * "how far did the pipeline move this month" is the question a funnel answers,
 * and dating it by lead creation would leave last quarter's deals invisible in
 * the month they were actually won.
 *
 * The counting is `COUNT(DISTINCT leadId)` grouped by stage, in
 * `src/lib/reports/aggregate.ts`. `DISTINCT` is the part that matters: a lead
 * pushed back to Negotiation and forward again has two history rows for that
 * stage and is still one lead. Phases 3 and 4 did the distinct-and-count in
 * memory over every history row in the period; Phase 6 made it an aggregate,
 * because the dashboard asks the same question for eight verticals at once.
 */
export async function reachedByStage(
  range: ResolvedRange,
  people: PeopleScope,
  verticalId: string,
): Promise<Map<string, number>> {
  return reachedByStageAggregate(range, people, verticalId)
}

/** `numerator ÷ denominator` as a percentage, or null when there is no base. */
export function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return (numerator / denominator) * 100
}

export function formatRate(value: number | null): string {
  if (value === null) return '—'
  return `${value.toFixed(1)}%`
}

// ---------------------------------------------------------------------------
// The funnel
// ---------------------------------------------------------------------------

export type FunnelStep = {
  key: string
  label: string
  value: number
  /** Conversion from the step above, already a percentage. */
  conversion: number | null
  /** What the conversion divided by, for the tooltip-free explanation on screen. */
  conversionOf: string | null
}

export type VerticalFunnel = {
  verticalId: string
  verticalName: string
  /** Counter steps, in metric order. Empty for Product Sales and Other Sources. */
  above: FunnelStep[]
  /** The counter → lead step. Null when the vertical has no counters. */
  bridge: FunnelStep | null
  leadsCreated: number
  /** Stage steps, in pipeline order. */
  below: FunnelStep[]
  /** counter(first metric) → reached(won), the whole chain end to end. */
  overall: FunnelStep | null
}

export type FunnelVertical = {
  id: string
  name: string
  metrics: Array<{ id: string; key: string; label: string; isLeadTrigger: boolean }>
  stages: Array<{ id: string; code: string; name: string; isWon: boolean; isLost: boolean }>
}

/**
 * Assemble a vertical's funnel from its own master data.
 *
 * Built from `VerticalMetric` and `PipelineStage` rather than from a table of
 * the eight verticals, for the same reason the lead form is (see
 * `src/lib/leads/vertical-form.ts`): every metric and stage in
 * docs/02-funnels-and-metrics.md §4 is editable in Master Data, so a hard-coded
 * funnel would start lying the first time someone renamed a stage. Reading each
 * conversion as "this step ÷ the step above" reproduces §4.1–§4.6 exactly,
 * because those tables are themselves consecutive pairs down each list.
 *
 * The lost stage is left out of the chain. It is an outcome, not a step: a lead
 * does not pass *through* Lost on its way to Won, and including it would make
 * the Negotiation → Won conversion divide by the wrong thing. It is still
 * reported, just beside the funnel rather than inside it.
 */
export function buildFunnel(
  vertical: FunnelVertical,
  counters: Map<string, number>,
  leadsCreated: number,
  reached: Map<string, number>,
): VerticalFunnel {
  const above: FunnelStep[] = vertical.metrics.map((metric, index) => {
    const value = counters.get(metric.id) ?? 0
    const previous = index === 0 ? null : vertical.metrics[index - 1]
    const base = previous ? (counters.get(previous.id) ?? 0) : 0

    return {
      key: `metric:${metric.id}`,
      label: metric.label,
      value,
      conversion: previous ? rate(value, base) : null,
      conversionOf: previous?.label ?? null,
    }
  })

  // The bridge divides by the metric flagged `isLeadTrigger` — the last counter
  // before a Lead exists (open question Q1). Falling back to the final metric
  // keeps a newly added vertical's funnel honest before anyone sets the flag.
  const trigger =
    vertical.metrics.find((metric) => metric.isLeadTrigger) ??
    vertical.metrics.at(-1) ??
    null

  const bridge: FunnelStep | null = trigger
    ? {
        key: 'bridge',
        label: 'Leads created',
        value: leadsCreated,
        conversion: rate(leadsCreated, counters.get(trigger.id) ?? 0),
        conversionOf: trigger.label,
      }
    : null

  const chain = vertical.stages.filter((stage) => !stage.isLost)

  const below: FunnelStep[] = chain.map((stage, index) => {
    const value = reached.get(stage.id) ?? 0
    const previous = index === 0 ? null : chain[index - 1]

    // The first stage converts from the leads created above it — that is the
    // seam between the two halves of the funnel, and leaving it blank would
    // break the chain exactly where decision D1 draws its line.
    const base = previous ? (reached.get(previous.id) ?? 0) : leadsCreated
    const baseLabel = previous?.name ?? 'Leads created'

    return {
      key: `stage:${stage.id}`,
      label: stage.name,
      value,
      conversion: rate(value, base),
      conversionOf: baseLabel,
    }
  })

  const won = vertical.stages.find((stage) => stage.isWon)
  const first = vertical.metrics[0] ?? null

  const overall: FunnelStep | null =
    won && first
      ? {
          key: 'overall',
          label: `${first.label} → ${won.name}`,
          value: reached.get(won.id) ?? 0,
          conversion: rate(reached.get(won.id) ?? 0, counters.get(first.id) ?? 0),
          conversionOf: first.label,
        }
      : won
        ? {
            key: 'overall',
            label: `Leads → ${won.name}`,
            value: reached.get(won.id) ?? 0,
            conversion: rate(reached.get(won.id) ?? 0, leadsCreated),
            conversionOf: 'Leads created',
          }
        : null

  return {
    verticalId: vertical.id,
    verticalName: vertical.name,
    above,
    bridge,
    leadsCreated,
    below,
    overall,
  }
}
