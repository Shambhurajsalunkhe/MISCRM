import { z } from 'zod'

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
 * The second case is normal here, not exotic: the lead form shows a product
 * picker *or* a service picker but never both, and shows the campaign field
 * only for Digital Marketing. A schema built from `z.string().nullable()`
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

/** `<input type="date">` and `datetime-local` both arrive as strings. */
export const optionalDate = absentAsBlank
  .transform((value) => (value === '' ? null : new Date(value)))
  .refine(
    (value) => value === null || !Number.isNaN(value.getTime()),
    'Enter a valid date.',
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
