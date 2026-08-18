import { z } from 'zod'

import { isSafeExternalUrl } from '@/lib/safe-url'

/**
 * Zod builders for optional fields arriving from a `<form>`.
 *
 * These exist because of a bug worth naming: a form field can reach the server
 * in two different "empty" shapes, and only one of them is obvious.
 *
 *  - The input rendered but left blank -> `''`.
 *  - **The input never rendered at all -> the key is absent from `FormData`
 *    entirely**, so `formValues()` omits it and Zod sees `undefined`.
 *
 * The second case is normal here, not exotic: the lead form shows the product
 * picker only for Product Sales, and the campaign field only for Digital
 * Marketing. A schema built from `z.string().nullable()`
 * accepts `''` but rejects `undefined`, so every one of those submissions
 * failed validation — and failed invisibly, because the error was attached to
 * a field that was not on screen to highlight.
 *
 * Everything below therefore treats "absent" and "blank" as the same thing and
 * normalises both to `null`. Required fields keep using plain `z.string()`,
 * where a missing key genuinely is an error worth reporting.
 */

/** Absent or blank, both normalised to a trimmed string. */
const absentAsBlank = z
  .string()
  .optional()
  .transform((value) => (value ?? '').trim())

/** A `<select>` of record ids: `''` and absent both mean "not set". */
export const optionalId = absentAsBlank.transform((value) =>
  value === '' ? null : value,
)

export const optionalText = (max: number) =>
  absentAsBlank
    .refine(
      (value) => value.length <= max,
      `Keep this under ${max} characters.`,
    )
    .transform((value) => (value === '' ? null : value))

/**
 * Money as free text. Rejecting a typed `1,200` would be pedantic, and
 * silently reading it as `1` would be worse — strip separators, then insist on
 * a number.
 */
export const optionalMoney = absentAsBlank
  .transform((value) => value.replace(/[,\s]/g, ''))
  .transform((value) => (value === '' ? null : Number(value)))
  .refine(
    (value) => value === null || (Number.isFinite(value) && value >= 0),
    'Enter an amount, or leave it blank.',
  )

/**
 * `<input type="date">` and `datetime-local` both arrive as strings.
 *
 * A bare `yyyy-MM-dd` must be built from its parts rather than handed to
 * `new Date()`, which reads it as **UTC** midnight. Stored that way, a
 * follow-up date set for the 16th is 15 Aug 19:00 local at UTC-5, so it renders
 * and filters as the previous day. `datetime-local` values already carry a time
 * and are parsed as local by `Date`, so they stay on the normal path.
 */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

function parseFormDate(value: string): Date {
  const match = DATE_ONLY.exec(value)
  if (!match) return new Date(value)

  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(year, month - 1, day)

  // Rejects 31 February, which `Date` would otherwise roll into March.
  return date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : new Date(Number.NaN)
}

export const optionalDate = absentAsBlank
  .transform((value) => (value === '' ? null : parseFormDate(value)))
  .refine(
    (value) => value === null || !Number.isNaN(value.getTime()),
    'Enter a valid date.',
  )

/**
 * A web address typed by a user.
 *
 * Rejects anything that is not http(s) at the point of storage, so a
 * `javascript:` payload never reaches the database. Rendering guards against it
 * again — see `src/lib/safe-url.ts` — because defence at one layer is defence
 * until someone adds a second read path.
 */
export const optionalUrl = (max: number) =>
  optionalText(max).refine(
    (value) => isSafeExternalUrl(value),
    'Enter a web address starting with http:// or https://.',
  )

export const optionalEmail = absentAsBlank
  .transform((value) => (value === '' ? null : value.toLowerCase()))
  .refine(
    (value) => value === null || value.length <= 200,
    'That email address is too long.',
  )
  .refine(
    (value) => value === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value),
    'Enter a valid email address.',
  )
