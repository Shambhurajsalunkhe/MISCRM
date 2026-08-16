import 'server-only'

import { cache } from 'react'

import { prisma } from '@/lib/db'

/**
 * Read-side access to `AppSetting`.
 *
 * /admin/settings owns writing these; this is what everything else uses to read
 * them. Cached per request with `cache()`, so a lead list rendering forty rows
 * of currency does one query, not forty — and a change saved by an
 * administrator still takes effect on the very next request.
 */
const allSettings = cache(async (): Promise<Map<string, string>> => {
  const rows = await prisma.appSetting.findMany({
    select: { key: true, value: true },
  })
  return new Map(rows.map((row) => [row.key, row.value]))
})

export async function setting(key: string, fallback: string): Promise<string> {
  return (await allSettings()).get(key) ?? fallback
}

/** A boolean setting. Anything other than `true` is false — absent included. */
export async function booleanSetting(
  key: string,
  fallback: boolean,
): Promise<boolean> {
  const value = (await allSettings()).get(key)
  if (value === undefined) return fallback
  return value === 'true'
}

/**
 * The symbol to put in front of an amount.
 *
 * Decision D4 fixes the app to a single currency, so this is a label rather
 * than a conversion — which is exactly why it can be a plain string lookup and
 * not `Intl.NumberFormat` with a currency code.
 */
export function currencySymbol(): Promise<string> {
  return setting('currency.symbol', '$')
}
