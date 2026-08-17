/**
 * Money arithmetic, done in whole cents.
 *
 * Every amount in this app is `Decimal(14, 2)` in Postgres and arrives in
 * JavaScript as a `Decimal` object or a string. The moment one of those becomes
 * a `number` and gets added to another, binary floating point starts rounding:
 * `0.1 + 0.2` is the canonical example, and an invoice for three payments of
 * `33.33` against a total of `99.99` is the version of it that shows up here —
 * the invoice stays `PARTIALLY_PAID` for ever, a cent short, and nobody can see
 * why.
 *
 * So sums and comparisons happen in integer cents and only the result is turned
 * back into a decimal for storage. `Number` is safe as the carrier: 2^53 cents
 * is about 90 trillion dollars, and the column tops out at 999,999,999,999.99.
 *
 * Decision D4 fixes the app to one currency, which is what makes plain integers
 * enough — there is no per-currency exponent to carry.
 */

/** What Prisma hands back for a `Decimal` column, plus the forms a form sends. */
export type MoneyInput =
  | { toString: () => string }
  | number
  | string
  | null
  | undefined

/** Cents, rounded half away from zero. `null` and unparseable both give 0. */
export function toCents(value: MoneyInput): number {
  if (value === null || value === undefined) return 0

  const numeric = typeof value === 'number' ? value : Number(value.toString())
  if (!Number.isFinite(numeric)) return 0

  // `Math.round` alone rounds -0.005 to -0.00 rather than -0.01. Amounts here
  // are never negative, but the helper is used by the reversal path too.
  const scaled = numeric * 100
  return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled)
}

/** Cents back to the number a `Decimal(14, 2)` column takes. */
export function fromCents(cents: number): number {
  return cents / 100
}

/** Sum a column of decimals without ever leaving integer arithmetic. */
export function sumCents(values: MoneyInput[]): number {
  return values.reduce<number>((total, value) => total + toCents(value), 0)
}
