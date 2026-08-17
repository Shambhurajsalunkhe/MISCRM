import { cn } from '@/lib/cn'

/**
 * Leads by Vertical, as a donut with a legend (docs/03 §1, README §26).
 *
 * Server-rendered inline SVG rather than Recharts — deviation D16, recorded in
 * docs/04. Recharts is a client component with a runtime of its own, and every
 * chart on this dashboard is a static picture of numbers the server already has:
 * there is nothing to hover, zoom or animate. Drawing it as SVG keeps the whole
 * dashboard a server component, ships no chart bundle, prints, and lets each
 * slice be a real `<a>` into the filtered lead list — which is the drill-down
 * chain of README §37 and the one interaction that actually matters here.
 *
 * The legend is not decoration. A donut on its own answers "which is biggest"
 * and nothing else; the counts and shares beside it are what someone reads.
 */

export type Slice = {
  key: string
  label: string
  value: number
  href?: string
}

/**
 * Eight distinguishable hues, because eight verticals is the designed maximum
 * and a ninth added in Master Data has to draw *something*. It wraps rather than
 * generating a colour from the id: a slice whose colour changed when a vertical
 * was renamed would be worse than two slices sharing one.
 */
const COLOURS = [
  '#1e293b',
  '#0ea5e9',
  '#f59e0b',
  '#10b981',
  '#8b5cf6',
  '#ef4444',
  '#14b8a6',
  '#a3a3a3',
]

const RADIUS = 60
const THICKNESS = 22
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function Donut({
  slices,
  total,
  centreLabel,
}: {
  slices: Slice[]
  /** Passed in rather than summed, so a filtered chart can say "of 240". */
  total: number
  centreLabel?: string
}) {
  const drawn = slices.filter((slice) => slice.value > 0)
  const sum = drawn.reduce((carry, slice) => carry + slice.value, 0)

  let offset = 0

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg
        viewBox="0 0 160 160"
        className="h-40 w-40 shrink-0 -rotate-90"
        role="img"
        aria-label={`${total.toLocaleString('en-GB')} leads across ${drawn.length} vertical(s)`}
      >
        <circle
          cx="80"
          cy="80"
          r={RADIUS}
          fill="none"
          stroke="#f1f5f9"
          strokeWidth={THICKNESS}
        />
        {sum > 0
          ? drawn.map((slice, index) => {
              const length = (slice.value / sum) * CIRCUMFERENCE
              const dash = `${length} ${CIRCUMFERENCE - length}`
              const start = -offset
              offset += length

              return (
                <circle
                  key={slice.key}
                  cx="80"
                  cy="80"
                  r={RADIUS}
                  fill="none"
                  stroke={COLOURS[index % COLOURS.length]}
                  strokeWidth={THICKNESS}
                  strokeDasharray={dash}
                  strokeDashoffset={start}
                />
              )
            })
          : null}
        {/* Un-rotated so the number reads horizontally inside a rotated chart. */}
        <g className="rotate-90" style={{ transformOrigin: '80px 80px' }}>
          <text
            x="80"
            y="76"
            textAnchor="middle"
            className="fill-slate-900 text-lg font-semibold"
          >
            {total.toLocaleString('en-GB')}
          </text>
          <text
            x="80"
            y="94"
            textAnchor="middle"
            className="fill-slate-500 text-[10px] uppercase tracking-wide"
          >
            {centreLabel ?? 'Leads'}
          </text>
        </g>
      </svg>

      <ul className="min-w-0 flex-1 space-y-1.5">
        {drawn.length === 0 ? (
          <li className="text-sm text-slate-500">
            No leads in this period, so there is nothing to divide up.
          </li>
        ) : (
          drawn.map((slice, index) => {
            const share = sum > 0 ? (slice.value / sum) * 100 : 0
            const row = (
              <>
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: COLOURS[index % COLOURS.length] }}
                />
                <span className="min-w-0 flex-1 truncate">{slice.label}</span>
                <span className="tabular-nums font-medium text-slate-900">
                  {slice.value.toLocaleString('en-GB')}
                </span>
                <span className="w-14 text-right tabular-nums text-slate-500">
                  {share.toFixed(1)}%
                </span>
              </>
            )

            return (
              <li key={slice.key}>
                {slice.href ? (
                  <a
                    href={slice.href}
                    className={cn(
                      'flex items-center gap-2 rounded px-1 py-0.5 text-sm text-slate-700',
                      'transition hover:bg-slate-50 hover:text-slate-900',
                    )}
                  >
                    {row}
                  </a>
                ) : (
                  <span className="flex items-center gap-2 px-1 py-0.5 text-sm text-slate-700">
                    {row}
                  </span>
                )}
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}
