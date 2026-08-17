import { cn } from '@/lib/cn'

/**
 * A labelled horizontal bar list — the Pipeline Overview of docs/03 §1, and the
 * shape every "these categories against each other" panel on the reports uses.
 *
 * Close cousin of `src/components/funnel-steps.tsx`, kept separate because a
 * funnel step carries a conversion from the step above and these rows do not: a
 * bar here is one bucket beside other buckets, not a stage somebody passed
 * through on the way to the next. Merging them would mean a component with two
 * halves, one of which is always dead.
 *
 * Same reasoning as the donut for why this is divs and not Recharts (deviation
 * D16): nothing here is interactive except the link, and the link is the point.
 */

export type Bar = {
  key: string
  label: string
  value: number
  /** Rendered on the right of the bar — a percentage, a money figure, a count. */
  note?: string
  href?: string
  tone?: 'default' | 'won' | 'lost' | 'muted'
}

const TONES: Record<NonNullable<Bar['tone']>, string> = {
  default: 'bg-slate-800',
  won: 'bg-emerald-600',
  lost: 'bg-rose-500',
  muted: 'bg-slate-300',
}

export function Bars({
  bars,
  max,
  emptyLabel = 'Nothing to show for this period.',
}: {
  bars: Bar[]
  /**
   * The shared scale. Passed in rather than derived, so two charts beside each
   * other can be compared — a per-chart maximum makes a panel of forty leads
   * look identical to a panel of four hundred, which is the one thing a bar
   * chart exists to prevent.
   */
  max?: number
  emptyLabel?: string
}) {
  if (bars.length === 0) {
    return <p className="text-sm text-slate-500">{emptyLabel}</p>
  }

  const scale = Math.max(max ?? 0, ...bars.map((bar) => bar.value), 1)

  return (
    <ol className="space-y-2">
      {bars.map((bar) => {
        // A visible sliver for a non-zero value: a bar that rounds to nothing
        // reads as "no data" when it means "one".
        const width =
          bar.value > 0 ? Math.max((bar.value / scale) * 100, 0.75) : 0

        const label = (
          <span className="block truncate">{bar.label}</span>
        )

        return (
          <li key={bar.key} className="grid grid-cols-12 items-center gap-3">
            <div className="col-span-5 min-w-0 text-sm text-slate-700 sm:col-span-4">
              {bar.href ? (
                <a
                  href={bar.href}
                  className="block truncate hover:text-slate-900 hover:underline"
                >
                  {bar.label}
                </a>
              ) : (
                label
              )}
            </div>

            <div className="col-span-4 sm:col-span-5">
              <div className="h-6 w-full overflow-hidden rounded bg-slate-100">
                <div
                  className={cn('h-full rounded', TONES[bar.tone ?? 'default'])}
                  style={{ width: `${width}%` }}
                />
              </div>
            </div>

            <div className="col-span-2 text-right text-sm font-medium tabular-nums text-slate-900">
              {bar.value.toLocaleString('en-GB')}
            </div>

            <div className="col-span-1 text-right text-xs tabular-nums text-slate-500">
              {bar.note ?? ''}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
