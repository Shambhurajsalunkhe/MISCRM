import 'server-only'

import type { TransactionClient } from '@/lib/db'
import { fromCents, sumCents, toCents } from '@/lib/commercials/money'
import type { QuotationStatus } from '@/generated/prisma/enums'

/**
 * Quotation arithmetic (README §20).
 *
 * `subtotal`, and therefore `totalAmount`, are computed from the line items
 * every time one changes. Neither is ever typed, for the same reason
 * `Invoice.amountReceived` is not: a quotation whose header says one number and
 * whose lines add up to another is a document that gets sent to a client, and
 * Order Value (docs/02 §4.6) sums the header.
 *
 *   lineTotal   = quantity × unitPrice
 *   subtotal    = SUM(lineTotal)
 *   totalAmount = subtotal − discount + tax
 *
 * Discount and tax stay typed because they are decisions rather than sums.
 */

export function lineTotalCents(quantity: number, unitPrice: number): number {
  // Quantity carries two decimals of its own (`Decimal(10, 2)`), so the
  // multiplication happens in units and only the money is rounded — 2.5 hours
  // at $99.99 is $249.98 rather than $249.97 built from a rounded rate.
  return Math.round(quantity * toCents(unitPrice))
}

/**
 * The statuses after which a quotation's numbers stop being editable.
 *
 * An accepted quote is what the client agreed to and what invoices are raised
 * against; a rejected or expired one is a record of an offer that was made.
 * Editing the lines of any of the three rewrites history rather than correcting
 * a draft — the honest move is a new quotation, which is why `DRAFT` and `SENT`
 * are the only two that stay open.
 */
export const QUOTATION_FROZEN_STATUSES: QuotationStatus[] = [
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
]

export function isQuotationEditable(status: QuotationStatus): boolean {
  return !QUOTATION_FROZEN_STATUSES.includes(status)
}

export type QuotationTotals = {
  subtotal: number
  discount: number
  taxAmount: number
  totalAmount: number
}

/**
 * Re-read the line items and write the header totals back.
 *
 * Returns what it wrote so a caller can put the new total in a message without
 * a second read — the same shape `recalculateInvoice` uses next door.
 */
export async function recalculateQuotation(
  tx: TransactionClient,
  quotationId: string,
  overrides?: { discount?: number; taxAmount?: number },
): Promise<QuotationTotals | null> {
  const quotation = await tx.quotation.findUnique({
    where: { id: quotationId },
    select: { id: true, discount: true, taxAmount: true },
  })

  if (!quotation) return null

  const items = await tx.quotationItem.findMany({
    where: { quotationId },
    select: { lineTotal: true },
  })

  const subtotalCents = sumCents(items.map((item) => item.lineTotal))
  const discountCents =
    overrides?.discount !== undefined
      ? toCents(overrides.discount)
      : toCents(quotation.discount)
  const taxCents =
    overrides?.taxAmount !== undefined
      ? toCents(overrides.taxAmount)
      : toCents(quotation.taxAmount)

  // Floored at zero. A discount larger than the lines is a keying error, and a
  // negative quotation total would flow straight into Order Value and subtract
  // from a figure nobody could trace back to this row.
  const totalCents = Math.max(subtotalCents - discountCents + taxCents, 0)

  const totals: QuotationTotals = {
    subtotal: fromCents(subtotalCents),
    discount: fromCents(discountCents),
    taxAmount: fromCents(taxCents),
    totalAmount: fromCents(totalCents),
  }

  await tx.quotation.update({ where: { id: quotationId }, data: totals })

  return totals
}
