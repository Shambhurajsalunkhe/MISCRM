import { formatRate, type FunnelStep } from '@/lib/prospecting/metrics'
import { cn } from '@/lib/cn'

/**
 * The funnel, drawn as bars on one shared scale.
 *
 * One scale across both halves rather than per-section, because the drop the
 * chart exists to show is the one at decision D1's line — 850 pitches to 145
 * responses. Rescaling each half would flatten exactly that, and leave two
 * tidy-looking funnels that hide the only step anybody is worried about.
 *
 * Recharts arrives with the dashboard in Phase 6. This is a list of divs, and
 * for a chart that is nine labelled rows in reading order that is the better
 * answer: it needs no client bundle, it is legible to a screen reader, and it
 * prints.
 */
export function FunnelSteps({
  steps,
  max,
  tone = 'default',
}: {
  steps: FunnelStep[]
  /** Shared denominator for the bar widths, across every section. */
  max: number
  tone?: 'default' | 'bridge'
}) {
  return (
    <ol className="space-y-2">
      {steps.map((step) => {
        const width = max > 0 ? Math.max((step.value / max) * 100, 0.75) : 0

        return (
          <li key={step.key} className="grid grid-cols-12 items-center gap-3">
            {/* The label gets the extra column on a narrow screen: a truncated
                stage name is worse than a shorter bar, because the bar is only
                a comparison and the name is what it is a comparison of. */}
            <div className="col-span-5 min-w-0 text-sm text-slate-700 sm:col-span-4">
              <span className="block truncate">{step.label}</span>
              {step.conversionOf ? (
                <span className="block truncate text-xs text-slate-400">
                  of {step.conversionOf}
                </span>
              ) : null}
            </div>

            <div className="col-span-4 sm:col-span-5">
              <div className="h-6 w-full overflow-hidden rounded bg-slate-100">
                <div
                  className={cn(
                    'h-full rounded',
                    tone === 'bridge' ? 'bg-sky-500' : 'bg-slate-800',
                  )}
                  style={{ width: `${width}%` }}
                />
              </div>
            </div>

            <div className="col-span-2 text-right text-sm font-medium tabular-nums text-slate-900">
              {step.value.toLocaleString('en-GB')}
            </div>

            <div
              className={cn(
                'col-span-1 text-right text-sm tabular-nums',
                step.conversion === null ? 'text-slate-300' : 'text-slate-600',
              )}
            >
              {formatRate(step.conversion)}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
