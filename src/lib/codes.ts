import 'server-only'

import type { TransactionClient } from '@/lib/db'

/**
 * Record codes — `UP-0001` for leads, `CL-0001` for clients (README §5).
 *
 * Every function here takes the transaction client rather than reaching for the
 * module-level `prisma`. A code issued outside the transaction that inserts the
 * row it belongs to is a code that survives a rolled-back insert, which shows up
 * later as an unexplained gap in the sequence.
 *
 * Allocation is a single `UPDATE … RETURNING`, so two people creating a lead at
 * the same moment serialise on the row lock rather than racing a read and a
 * write. That is the whole reason these counters are table rows and not
 * `SELECT max(...) + 1`.
 */

/** Fallback when `lead_code_padding` is missing or unreadable. */
const DEFAULT_PADDING = 4

/** Guards against a setting like `40` producing an unusable code. */
const MIN_PADDING = 3
const MAX_PADDING = 8

function format(prefix: string, value: number, padding: number): string {
  return `${prefix}-${String(value).padStart(padding, '0')}`
}

/**
 * How many digits a newly issued code carries.
 *
 * Read at issue time rather than cached: an administrator changing it in
 * /admin/settings expects the next lead to use the new width, and existing codes
 * are never rewritten (the setting's own hint says so).
 */
export async function codePadding(tx: TransactionClient): Promise<number> {
  const setting = await tx.appSetting.findUnique({
    where: { key: 'lead_code_padding' },
    select: { value: true },
  })

  const parsed = Number.parseInt(setting?.value ?? '', 10)
  if (!Number.isInteger(parsed)) return DEFAULT_PADDING

  return Math.min(Math.max(parsed, MIN_PADDING), MAX_PADDING)
}

/**
 * The next lead code for a vertical, e.g. `UP-0001`.
 *
 * Counters restart each calendar year within a vertical, which is what
 * `LeadSequence`'s composite key encodes. `upsert` covers the first lead of a
 * new year without a separate "does the row exist" round trip.
 */
export async function nextLeadCode(
  tx: TransactionClient,
  vertical: { id: string; leadPrefix: string },
  now: Date = new Date(),
): Promise<string> {
  const year = now.getFullYear()

  const sequence = await tx.leadSequence.upsert({
    where: { verticalId_year: { verticalId: vertical.id, year } },
    create: { verticalId: vertical.id, year, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  })

  return format(vertical.leadPrefix, sequence.lastNumber, await codePadding(tx))
}

/** The next code from a named counter, e.g. `client` -> `CL-0001`. */
export async function nextSequenceCode(
  tx: TransactionClient,
  key: string,
  prefix: string,
): Promise<string> {
  const sequence = await tx.numberSequence.upsert({
    where: { key },
    create: { key, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  })

  return format(prefix, sequence.lastNumber, await codePadding(tx))
}

/** Client codes run on one company-wide counter — they are not per-vertical. */
export function nextClientCode(tx: TransactionClient): Promise<string> {
  return nextSequenceCode(tx, 'client', 'CL')
}

/**
 * `REQ-0001` for a staffing requirement.
 *
 * One counter for the whole company rather than one per lead. README §14 draws
 * the codes as `REQ-001, REQ-002, REQ-003` under a single lead, which reads as
 * per-lead numbering — but a requirement is linked to, searched for and
 * discussed on its own, and two different leads each holding a `REQ-001` is a
 * code that stops identifying anything. The three-under-one-lead reading is
 * preserved by the requirement list grouping under its lead, not by the number.
 */
export function nextRequirementCode(tx: TransactionClient): Promise<string> {
  return nextSequenceCode(tx, 'requirement', 'REQ')
}

/** `CAND-0001`. The candidate master is company-wide (decision D9). */
export function nextCandidateCode(tx: TransactionClient): Promise<string> {
  return nextSequenceCode(tx, 'candidate', 'CAND')
}

/**
 * The three commercial documents, each on its own company-wide counter.
 *
 * Separate counters rather than one shared "document" sequence, because these
 * numbers leave the building. A quotation and the invoice raised against it are
 * two things the client files separately, and `QT-0007` / `INV-0007` reading as
 * a matched pair when they are unrelated is worse than either being sparse.
 *
 * They are not per-vertical for the same reason requirement codes are not
 * per-lead: an invoice is chased, queried and reconciled on its own, and two of
 * them sharing a number identifies nothing.
 */
export function nextQuotationCode(tx: TransactionClient): Promise<string> {
  return nextSequenceCode(tx, 'quotation', 'QT')
}

export function nextContractCode(tx: TransactionClient): Promise<string> {
  return nextSequenceCode(tx, 'contract', 'CTR')
}

export function nextInvoiceCode(tx: TransactionClient): Promise<string> {
  return nextSequenceCode(tx, 'invoice', 'INV')
}

// A `syncClientSequence` helper lived here to fast-forward the counter past
// pre-existing clients. It was never called, and it read-then-wrote without a
// transaction, so two callers could have moved the counter *backwards* and
// started re-issuing codes that already existed. Removed rather than fixed:
// the CSV importer in Phase 7 is the first thing that will genuinely need it,
// and it should be written then, against that use, as a single conditional
// `updateMany` that can only ever move the counter forward.
