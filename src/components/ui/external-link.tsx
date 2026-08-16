import { cn } from '@/lib/cn'
import { safeExternalUrl } from '@/lib/safe-url'

/**
 * A link to a user-typed URL.
 *
 * Renders an anchor only when the value resolves to an http(s) URL; anything
 * else is shown as plain text, so a stored `javascript:` payload is visible but
 * inert. See `src/lib/safe-url.ts` for why the obvious guard is not enough.
 *
 * The display text is always what the user typed, not the normalised URL —
 * `acme.com` should read as `acme.com`, not `https://acme.com/`.
 *
 * `noreferrer` as well as `noopener`: the destination has no business learning
 * which lead the click came from.
 */
export function ExternalLink({
  href,
  className,
}: {
  href: string | null | undefined
  className?: string
}) {
  const safe = safeExternalUrl(href)

  if (!href) return <>—</>

  if (!safe) {
    return (
      <span className={cn('break-all text-slate-500', className)} title="Not a valid web address">
        {href}
      </span>
    )
  }

  return (
    <a
      href={safe}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        'break-all text-slate-700 underline hover:text-slate-900',
        className,
      )}
    >
      {href}
    </a>
  )
}
