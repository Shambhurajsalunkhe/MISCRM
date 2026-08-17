/**
 * Display formatting shared by every list, detail page and export.
 *
 * Everything here is deliberately locale-fixed to `en-GB`. A CRM where one
 * person reads `08/09` as September and another as August is a CRM that
 * schedules the wrong follow-up, so dates render as `08 Sep 2026` throughout
 * rather than following the browser.
 */

/** What Prisma hands back for a `Decimal` column, without importing its runtime. */
export type DecimalLike = { toString: () => string } | number | null | undefined

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
}

export function formatDate(value: Date | null | undefined): string {
  return value ? value.toLocaleDateString('en-GB', DATE_FORMAT) : '—'
}

export function formatDateTime(value: Date | null | undefined): string {
  if (!value) return '—'
  return value.toLocaleString('en-GB', {
    ...DATE_FORMAT,
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** `yyyy-MM-dd`, for `<input type="date">` round-trips. */
export function toDateInputValue(value: Date | null | undefined): string {
  if (!value) return ''
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${value.getFullYear()}-${month}-${day}`
}

/**
 * `yyyy-MM-ddTHH:mm`, for `<input type="datetime-local">` round-trips.
 *
 * Local parts throughout, never `toISOString()`: that renders UTC, so a demo at
 * 09:00 in Delhi comes back into the control as 03:30 and saves itself five and
 * a half hours earlier every time somebody opens the form.
 */
export function toDateTimeInputValue(value: Date | null | undefined): string {
  if (!value) return ''
  const hours = String(value.getHours()).padStart(2, '0')
  const minutes = String(value.getMinutes()).padStart(2, '0')
  return `${toDateInputValue(value)}T${hours}:${minutes}`
}

export function formatMoney(
  value: DecimalLike,
  symbol = '$',
): string {
  if (value === null || value === undefined) return '—'

  const numeric = typeof value === 'number' ? value : Number(value.toString())
  if (!Number.isFinite(numeric)) return '—'

  return `${symbol}${numeric.toLocaleString('en-GB', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`
}

/**
 * "3 days", "5 hours" — how long something has been sitting.
 *
 * Used by the aging column on the lead list and the stage badge on the detail
 * page. Rounds down, because a lead that entered a stage 47 hours ago has been
 * there one day, not two.
 */
export function formatAge(since: Date, now: Date = new Date()): string {
  const ms = now.getTime() - since.getTime()
  if (ms < 0) return 'just now'

  const hours = Math.floor(ms / 3_600_000)
  if (hours < 1) return 'under an hour'
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`

  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}

/** Whole days between two instants, floored. Negative when `since` is future. */
export function daysBetween(since: Date, now: Date = new Date()): number {
  return Math.floor((now.getTime() - since.getTime()) / 86_400_000)
}
