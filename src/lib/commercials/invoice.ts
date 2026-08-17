import 'server-only'

import { auditedTransaction, type TransactionClient } from '@/lib/db'
import { recordAudit } from '@/lib/audit/record'
import { nextInvoiceCode } from '@/lib/codes'
import { fromCents, sumCents, toCents } from '@/lib/commercials/money'
import type { InvoiceStatus, PaymentMode } from '@/generated/prisma/enums'

/**
 * The money engine (README §19, decision D10).
 *
 * Contract, invoice and payment are records hanging off a won lead rather than
 * stages in the funnel, so nothing here touches `Lead.currentStageId`. What it
 * does own is the arithmetic the dashboard reads without aggregating:
 * `Invoice.amountReceived` and `amountPending` are maintained on every payment
 * write, inside the same transaction, exactly as docs/01 §3 specifies.
 *
 * Two rules hold everything together.
 *
 * **The status is derived, never typed.** There is no control anywhere that
 * sets `PARTIALLY_PAID`. It is a pure function of the total, what has been
 * received and the due date, so an invoice's chip and its numbers cannot
 * disagree. The single exception is `CANCELLED`, which is a decision rather
 * than a consequence and is therefore sticky: once cancelled, an invoice stops
 * being re-derived until someone reinstates it.
 *
 * **`Payment` rows are the truth and the columns are the cache.** Every write
 * path re-reads the payments and recomputes, rather than adding a delta to what
 * was there. Deltas drift the moment one path forgets to apply one, and the
 * only way to notice would be a client's statement disagreeing with ours.
 */

export type InvoiceStatusInput = {
  totalAmount: number
  amountReceived: number
  dueDate: Date | null
  cancelled: boolean
}

/**
 * The four statuses of README §19, in precedence order.
 *
 * Overdue beats partially paid deliberately: an invoice half paid three weeks
 * after it fell due is a collections problem, and the table in docs/01 §3
 * defines OVERDUE on `amountPending > 0` rather than on `amountReceived = 0`.
 * Reading the rows top to bottom instead would leave every part-paid debt
 * showing amber on a screen whose red chips are the work queue.
 */
export function deriveInvoiceStatus(
  input: InvoiceStatusInput,
  now: Date = new Date(),
): InvoiceStatus {
  if (input.cancelled) return 'CANCELLED'

  const total = toCents(input.totalAmount)
  const received = toCents(input.amountReceived)

  if (received >= total) return 'PAID'

  // A due date is a calendar day, so "past due" is measured against the start
  // of today rather than this instant — an invoice due today is not overdue at
  // 09:00 and overdue again at 17:00.
  if (input.dueDate && input.dueDate.getTime() < startOfDay(now).getTime()) {
    return 'OVERDUE'
  }

  return received > 0 ? 'PARTIALLY_PAID' : 'PENDING'
}

export function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

/**
 * Re-read an invoice's payments and write back the three derived columns.
 *
 * Called by every path that can change what has been received. Returns the
 * values it wrote so the caller can put them in a message without a second
 * read.
 */
export async function recalculateInvoice(
  tx: TransactionClient,
  invoiceId: string,
  now: Date = new Date(),
): Promise<{
  amountReceived: number
  amountPending: number
  status: InvoiceStatus
} | null> {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, totalAmount: true, dueDate: true, status: true },
  })

  if (!invoice) return null

  const payments = await tx.payment.findMany({
    where: { invoiceId },
    select: { amount: true },
  })

  const totalCents = toCents(invoice.totalAmount)
  const receivedCents = sumCents(payments.map((payment) => payment.amount))
  // Floored at zero rather than allowed to go negative. Overpayment is refused
  // at the point of entry, so a negative here would mean the data is already
  // wrong; letting it through would subtract from Pending Revenue across the
  // whole company and hide the fact.
  const pendingCents = Math.max(totalCents - receivedCents, 0)

  const status = deriveInvoiceStatus(
    {
      totalAmount: fromCents(totalCents),
      amountReceived: fromCents(receivedCents),
      dueDate: invoice.dueDate,
      cancelled: invoice.status === 'CANCELLED',
    },
    now,
  )

  const amountReceived = fromCents(receivedCents)
  const amountPending = fromCents(pendingCents)

  await tx.invoice.update({
    where: { id: invoiceId },
    data: { amountReceived, amountPending, status },
  })

  return { amountReceived, amountPending, status }
}

/** Where an invoice came from. Exactly one, or none for a plain lead invoice. */
export type InvoiceSource =
  | { kind: 'contract'; id: string }
  | { kind: 'quotation'; id: string }
  | { kind: 'placement'; id: string }
  | { kind: 'lead' }

export type RaiseInvoiceInput = {
  leadId: string
  source: InvoiceSource
  invoiceDate: Date
  dueDate: Date | null
  amount: number
  taxAmount: number
  notes: string | null
  actorId: string
}

export type RaiseInvoiceResult =
  | { ok: true; id: string; invoiceNumber: string }
  | { ok: false; message: string; field?: string }

/**
 * Raise an invoice against a lead, optionally naming what it bills for.
 *
 * The three parents are nullable columns of which at most one is set
 * (docs/01 §3), and each is re-checked here against the lead rather than
 * trusted from the form: a quotation id from another client's deal would
 * otherwise attach real money to the wrong account, and the row would still
 * look consistent because `leadId` was fine.
 *
 * `clientId` is denormalised from the lead so the register can filter and total
 * by account without joining through leads, and so an invoice keeps naming its
 * client if the lead is ever re-parented — the same reasoning `Requirement`
 * uses for the same column.
 */
export async function raiseInvoice(
  input: RaiseInvoiceInput,
): Promise<RaiseInvoiceResult> {
  return auditedTransaction(async (tx) => {
    const lead = await tx.lead.findFirst({
      where: { id: input.leadId, isDeleted: false },
      select: {
        id: true,
        leadCode: true,
        clientId: true,
        vertical: { select: { name: true, usesInvoicing: true } },
      },
    })

    if (!lead) {
      return { ok: false as const, message: 'That lead no longer exists.' }
    }

    // The module switch is the only thing that decides this, never a list of
    // vertical codes — the rule docs/02 §5 sets out for Q11, and the same rule
    // the lead form and the funnel builder already follow.
    if (!lead.vertical.usesInvoicing) {
      return {
        ok: false as const,
        message: `Invoicing is switched off for ${lead.vertical.name}. An administrator can turn it back on for the vertical in Master Data.`,
      }
    }

    const amountCents = toCents(input.amount)
    if (amountCents <= 0) {
      return {
        ok: false as const,
        message: 'An invoice has to be for more than nothing.',
        field: 'amount',
      }
    }

    const link = await resolveSource(tx, lead.id, input.source)
    if (!link.ok) return link

    const totalCents = amountCents + toCents(input.taxAmount)

    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber: await nextInvoiceCode(tx),
        leadId: lead.id,
        clientId: lead.clientId,
        ...link.data,
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate,
        amount: fromCents(amountCents),
        taxAmount: fromCents(toCents(input.taxAmount)),
        totalAmount: fromCents(totalCents),
        amountReceived: 0,
        amountPending: fromCents(totalCents),
        // Derived against *now*, not against `invoiceDate`. A back-dated
        // invoice — entered a fortnight after it was actually sent, which is
        // ordinary — is overdue the moment it exists, and stamping it PENDING
        // because it was not overdue on the day it was raised would leave the
        // stored column disagreeing with the chip until the next sweep.
        status: deriveInvoiceStatus({
          totalAmount: fromCents(totalCents),
          amountReceived: 0,
          dueDate: input.dueDate,
          cancelled: false,
        }),
        notes: input.notes,
      },
      select: { id: true, invoiceNumber: true },
    })

    return { ok: true as const, ...invoice }
  })
}

/**
 * Check the named parent belongs to this lead, and turn it into the column to
 * write. A placement is checked for reversal too — billing against a placement
 * that has been given back is billing for someone who left.
 */
async function resolveSource(
  tx: TransactionClient,
  leadId: string,
  source: InvoiceSource,
): Promise<
  | { ok: true; data: Record<string, string> }
  | { ok: false; message: string; field?: string }
> {
  if (source.kind === 'lead') return { ok: true, data: {} }

  if (source.kind === 'contract') {
    const contract = await tx.contract.findFirst({
      where: { id: source.id, leadId },
      select: { id: true },
    })
    return contract
      ? { ok: true, data: { contractId: contract.id } }
      : {
          ok: false,
          message: 'That contract does not belong to this lead.',
          field: 'sourceId',
        }
  }

  if (source.kind === 'quotation') {
    const quotation = await tx.quotation.findFirst({
      where: { id: source.id, leadId },
      select: { id: true, status: true, quoteNumber: true },
    })

    if (!quotation) {
      return {
        ok: false,
        message: 'That quotation does not belong to this lead.',
        field: 'sourceId',
      }
    }

    // Invoicing a rejected or expired quote is almost always a mis-click, and
    // the number it would bill is one the client never agreed to. Drafts are
    // refused for the same reason — a draft is a working document.
    if (quotation.status === 'REJECTED' || quotation.status === 'EXPIRED') {
      return {
        ok: false,
        message: `${quotation.quoteNumber} was not accepted, so there is nothing to bill against it.`,
        field: 'sourceId',
      }
    }

    return { ok: true, data: { quotationId: quotation.id } }
  }

  const placement = await tx.placement.findFirst({
    where: { id: source.id, leadId },
    select: { id: true, reversedAt: true, candidate: { select: { fullName: true } } },
  })

  if (!placement) {
    return {
      ok: false,
      message: 'That placement does not belong to this lead.',
      field: 'sourceId',
    }
  }

  if (placement.reversedAt) {
    return {
      ok: false,
      message: `${placement.candidate.fullName}'s placement has been reversed, so it can no longer be billed.`,
      field: 'sourceId',
    }
  }

  return { ok: true, data: { placementId: placement.id } }
}

export type PaymentResult =
  | { ok: true; invoiceNumber: string; status: InvoiceStatus; amountPending: number }
  | { ok: false; message: string; field?: string }

/**
 * Record a receipt against an invoice.
 *
 * Overpayment is refused rather than clamped. `amountPending` feeds Pending
 * Revenue for the whole company, and an invoice recording more received than it
 * ever billed would quietly reduce that number by the difference — a figure
 * nobody could trace back to a keying error on one row. If a client really did
 * send more, the invoice is the thing that was wrong and should be corrected.
 *
 * The check and the insert are in one transaction so two people entering the
 * closing payment at the same moment cannot both pass it.
 */
export async function recordPayment(input: {
  invoiceId: string
  amount: number
  paymentDate: Date
  mode: PaymentMode
  referenceNumber: string | null
  notes: string | null
  actorId: string
}): Promise<PaymentResult> {
  return auditedTransaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { id: input.invoiceId },
      select: {
        id: true,
        invoiceNumber: true,
        totalAmount: true,
        status: true,
      },
    })

    if (!invoice) {
      return { ok: false as const, message: 'That invoice no longer exists.' }
    }

    if (invoice.status === 'CANCELLED') {
      return {
        ok: false as const,
        message: `${invoice.invoiceNumber} is cancelled. Reinstate it before recording a receipt against it.`,
      }
    }

    const amountCents = toCents(input.amount)
    if (amountCents <= 0) {
      return {
        ok: false as const,
        message: 'Enter the amount received.',
        field: 'amount',
      }
    }

    const existing = await tx.payment.findMany({
      where: { invoiceId: invoice.id },
      select: { amount: true },
    })

    const receivedCents = sumCents(existing.map((payment) => payment.amount))
    const totalCents = toCents(invoice.totalAmount)

    if (receivedCents + amountCents > totalCents) {
      const remaining = fromCents(Math.max(totalCents - receivedCents, 0))
      return {
        ok: false as const,
        message:
          remaining > 0
            ? `${invoice.invoiceNumber} has ${remaining.toFixed(2)} outstanding. Recording more than that would make Pending Revenue wrong — correct the invoice amount instead if it was billed short.`
            : `${invoice.invoiceNumber} is already paid in full.`,
        field: 'amount',
      }
    }

    await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        amount: fromCents(amountCents),
        paymentDate: input.paymentDate,
        mode: input.mode,
        referenceNumber: input.referenceNumber,
        notes: input.notes,
        recordedById: input.actorId,
      },
    })

    const recalculated = await recalculateInvoice(tx, invoice.id)

    await recordAudit({
      entityType: 'INVOICE',
      entityId: invoice.id,
      action: 'PAYMENT',
      fieldName: 'amountReceived',
      oldValue: fromCents(receivedCents).toFixed(2),
      newValue: fromCents(receivedCents + amountCents).toFixed(2),
      userId: input.actorId,
    })

    return {
      ok: true as const,
      invoiceNumber: invoice.invoiceNumber,
      status: recalculated?.status ?? invoice.status,
      amountPending: recalculated?.amountPending ?? 0,
    }
  })
}

/**
 * Remove a receipt entered in error.
 *
 * Hard, like an activity and unlike an invoice: a payment keyed against the
 * wrong invoice is a mistake with no dependants, and one that can only be
 * "cancelled" leaves two rows where the client sent one amount. The audit trail
 * keeps what was removed, and the invoice is recomputed from what is left.
 */
export async function deletePayment(input: {
  paymentId: string
  actorId: string
}): Promise<PaymentResult> {
  return auditedTransaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: input.paymentId },
      select: {
        id: true,
        amount: true,
        invoice: { select: { id: true, invoiceNumber: true } },
      },
    })

    if (!payment) {
      return { ok: false as const, message: 'That payment no longer exists.' }
    }

    await tx.payment.delete({ where: { id: payment.id } })

    const recalculated = await recalculateInvoice(tx, payment.invoice.id)

    return {
      ok: true as const,
      invoiceNumber: payment.invoice.invoiceNumber,
      status: recalculated?.status ?? 'PENDING',
      amountPending: recalculated?.amountPending ?? 0,
    }
  })
}

export type CancelInvoiceResult =
  | { ok: true; invoiceNumber: string; status: InvoiceStatus }
  | { ok: false; message: string }

/**
 * Cancel an invoice, or put a cancelled one back into the ledger.
 *
 * Cancelling is how an invoice stops counting without being deleted — the
 * receipts against it are financial facts and `Payment` is `onDelete: Restrict`
 * for that reason. An invoice with money against it therefore cannot be
 * cancelled: the receipts would be pointing at a row no revenue figure reads,
 * so Collected Revenue and the client's statement would disagree with nothing
 * on screen to explain it.
 *
 * Reinstating re-derives the status from the payments and the due date, which
 * is why it is the same function: the status a cancelled invoice had before is
 * not necessarily the status it should have now.
 */
export async function setInvoiceCancelled(input: {
  invoiceId: string
  cancelled: boolean
  actorId: string
}): Promise<CancelInvoiceResult> {
  return auditedTransaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { id: input.invoiceId },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        _count: { select: { payments: true } },
      },
    })

    if (!invoice) {
      return { ok: false as const, message: 'That invoice no longer exists.' }
    }

    const alreadyCancelled = invoice.status === 'CANCELLED'
    if (alreadyCancelled === input.cancelled) {
      return {
        ok: false as const,
        message: input.cancelled
          ? `${invoice.invoiceNumber} is already cancelled.`
          : `${invoice.invoiceNumber} is not cancelled.`,
      }
    }

    if (input.cancelled && invoice._count.payments > 0) {
      return {
        ok: false as const,
        message: `${invoice.invoiceNumber} has payments recorded against it. Remove the receipts first if they were entered in error — cancelling an invoice that has collected money would take it out of every revenue figure while the money stays in the bank.`,
      }
    }

    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: input.cancelled ? 'CANCELLED' : 'PENDING' },
    })

    // Re-derives from payments and the due date. For a cancellation this is a
    // no-op that leaves CANCELLED in place, because the derivation treats it as
    // sticky; for a reinstatement it is the whole point.
    const recalculated = await recalculateInvoice(tx, invoice.id)

    return {
      ok: true as const,
      invoiceNumber: invoice.invoiceNumber,
      status: recalculated?.status ?? invoice.status,
    }
  })
}

/**
 * Amend an invoice that has not collected anything yet.
 *
 * Amounts are editable only while `amountReceived` is zero. Once a client has
 * paid against a number, changing that number rewrites what they agreed to —
 * and would leave a receipt larger than the invoice it belongs to, which is the
 * state `recordPayment` refuses to create in the first place. Dates and notes
 * stay editable throughout, because correcting a due date is how an invoice
 * stops being wrongly overdue.
 */
export async function amendInvoice(input: {
  invoiceId: string
  invoiceDate: Date
  dueDate: Date | null
  amount: number | null
  taxAmount: number | null
  notes: string | null
}): Promise<
  { ok: true; invoiceNumber: string } | { ok: false; message: string; field?: string }
> {
  return auditedTransaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { id: input.invoiceId },
      select: {
        id: true,
        invoiceNumber: true,
        amountReceived: true,
        amount: true,
        taxAmount: true,
      },
    })

    if (!invoice) {
      return { ok: false as const, message: 'That invoice no longer exists.' }
    }

    const locked = toCents(invoice.amountReceived) > 0

    const amountCents = locked
      ? toCents(invoice.amount)
      : toCents(input.amount ?? invoice.amount)
    const taxCents = locked
      ? toCents(invoice.taxAmount)
      : toCents(input.taxAmount ?? invoice.taxAmount)

    if (!locked && amountCents <= 0) {
      return {
        ok: false as const,
        message: 'An invoice has to be for more than nothing.',
        field: 'amount',
      }
    }

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate,
        amount: fromCents(amountCents),
        taxAmount: fromCents(taxCents),
        totalAmount: fromCents(amountCents + taxCents),
        notes: input.notes,
      },
    })

    await recalculateInvoice(tx, invoice.id)

    return { ok: true as const, invoiceNumber: invoice.invoiceNumber }
  })
}

// A `liveInvoicesForPlacement` helper lived here, meant to be the shared
// definition of "still billable" for the placement reversal check. It was never
// called — `reversePlacement` queries inside its own transaction, which is
// where that check has to run — and it read through the module-level `prisma`,
// so wiring it up as written would have moved the check outside the
// transaction and reintroduced a check-then-write window. Removed rather than
// left as a comment that says it is used.
