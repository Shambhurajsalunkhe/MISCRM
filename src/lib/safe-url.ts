/**
 * Safe handling of user-typed URLs.
 *
 * Every URL in this app is typed by a colleague into a form — a client website,
 * a company LinkedIn page, an Upwork job link. That makes them untrusted input
 * rendered back to other users, and `<a href>` is the one place where untrusted
 * input becomes executable.
 *
 * The naive guard (`href.includes('://') ? href : 'https://' + href`) looks
 * like it handles this and does not. It neutralises `javascript:alert(1)`,
 * which has no `//`, while passing `javascript://x%0aalert(1)` through
 * untouched: `//` comments out the rest of the line, the newline ends the
 * comment, and the code runs. React only warns about `javascript:` hrefs today,
 * it does not block them — so a BDE could store one as a client website and it
 * would execute in our own origin, with the session of whoever clicked it.
 *
 * The fix is an allow-list of schemes, applied both when the value is stored
 * and again when it is rendered.
 */

/**
 * Real schemes, deliberately excluding `.` from the character class.
 *
 * RFC 3986 permits a dot in a scheme, but no scheme anyone types has one —
 * whereas `acme.com:8080` is a perfectly ordinary thing to paste. Allowing the
 * dot here would read that host as a scheme called `acme.com` and reject it.
 */
const HAS_SCHEME = /^[a-z][a-z0-9+-]*:/i

/**
 * Normalise a user-typed URL, or `null` if it is not safe to link to.
 *
 * A value with no scheme is treated as a hostname and given `https://`, which
 * is what someone typing `acme.com` means. A value carrying any scheme other
 * than http or https is rejected outright rather than coerced — `mailto:` and
 * `tel:` included, since these fields are for web addresses and silently
 * accepting others widens the surface for no benefit.
 */
export function safeExternalUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null

  const candidate = HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    const url = new URL(candidate)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    // Not parseable as a URL at all — a stray word in the website field.
    return null
  }
}

/** True when a value is either blank or a safe http(s) URL. For validation. */
export function isSafeExternalUrl(value: string | null | undefined): boolean {
  if (!value || value.trim() === '') return true
  return safeExternalUrl(value) !== null
}
