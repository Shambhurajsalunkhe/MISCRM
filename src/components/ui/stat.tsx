import { cn } from '@/lib/cn'

/**
 * A headline number with its label and, where one helps, the arithmetic behind
 * it.
 *
 * `hint` exists because a conversion percentage on its own is not a fact anyone
 * can act on — "12.4%" invites the question "of what", and the answer has to be
 * on the card rather than in someone's memory of how the funnel is defined.
 */
export function Stat({
  label,
  value,
  hint,
  href,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  href?: string
  tone?: 'default' | 'muted'
}) {
  const body = (
    <>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums',
          tone === 'muted' ? 'text-slate-500' : 'text-slate-900',
        )}
      >
        {value}
      </dd>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
    </>
  )

  const className = cn(
    'rounded-lg border border-slate-200 bg-white p-4',
    href ? 'transition hover:border-slate-300 hover:bg-slate-50' : undefined,
  )

  // `StatRow` is a `<dl>`, whose only permitted children are `<dt>`/`<dd>` and
  // wrapper `<div>`s. An `<a>` sitting directly inside it is invalid, and the
  // `<dt>`/`<dd>` pairing that makes the card readable to a screen reader comes
  // apart when the association is broken. So the div is always the child, and
  // the link lives inside it.
  return (
    <div className={href ? undefined : className}>
      {href ? (
        <a href={href} className={cn(className, 'block h-full')}>
          {body}
        </a>
      ) : (
        body
      )}
    </div>
  )
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</dl>
  )
}
