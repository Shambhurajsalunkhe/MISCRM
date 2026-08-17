'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { auditedTransaction, prisma } from '@/lib/db'
import { withAudit } from '@/lib/action'
import { can } from '@/lib/authz'
import { recordAudit } from '@/lib/audit/record'
import { nextQuotationCode } from '@/lib/codes'
import { PERMISSIONS } from '@/lib/permissions'
import { leadForCommercials } from '@/lib/commercials/access'
import { QUOTATION_STATUS_LABELS } from '@/lib/commercials/display'
import { fromCents, toCents } from '@/lib/commercials/money'
import {
  isQuotationEditable,
  lineTotalCents,
  recalculateQuotation,
} from '@/lib/commercials/quotation'
import { leadChildVisibilityFilter } from '@/lib/visibility'
import {
  optionalDate,
  optionalId,
  optionalMoney,
  optionalText,
} from '@/lib/form-fields'
import {
  actionError,
  actionSuccess,
  formValues,
  fromZodError,
  optionalString,
  type ActionState,
} from '@/lib/form'
import type { CurrentUser } from '@/lib/auth/session'
import type { QuotationStatus } from '@/generated/prisma/enums'

/**
 * Product Sales quotations and their line items (docs/03 §1).
 *
 * Gated on `commercial.manage`, which the permission matrix withholds from a
 * BDE: quoting a price is the account owner's job, and the same row covers
 * contracts and invoices. Row scope comes from the lead, so a BDM sees the
 * quotations on their own deals and a Sales Head sees all of them.
 *
 * Nothing here moves the lead's stage. "Quotation Shared" is a stage in the
 * Product Sales list that its owner advances deliberately, and inferring the
 * move from a draft being created would put a lead into Proposal before anybody
 * had sent anything.
 */

const quotationSchema = z.object({
  quoteDate: optionalDate,
  validUntil: optionalDate,
  discount: optionalMoney,
  taxAmount: optionalMoney,
  notes: optionalText(4000),
})

const itemSchema = z.object({
  productId: optionalId,
  description: z.string().trim().min(2, 'Describe the line.').max(500),
  quantity: z
    .string()
    .trim()
    .default('1')
    .refine(
      (value) => /^\d{1,6}(\.\d{1,2})?$/.test(value),
      'Enter a quantity, e.g. 1 or 2.5.',
    )
    .transform(Number)
    .refine((value) => value > 0, 'A line needs a quantity above zero.'),
  unitPrice: optionalMoney,
})

/** A quotation this user may work on, scoped through its lead. */
async function visibleQuotation(user: CurrentUser, id: string) {
  return prisma.quotation.findFirst({
    where: { id, ...(await leadChildVisibilityFilter(user)) },
    select: {
      id: true,
      quoteNumber: true,
      status: true,
      quoteDate: true,
      totalAmount: true,
      leadId: true,
      lead: { select: { id: true, clientId: true, dealValue: true } },
    },
  })
}

export async function createQuotationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let createdId: string | null = null

  const result = await withAudit(PERMISSIONS.COMMERCIAL_MANAGE, async (actor) => {
    const leadId = optionalString(formData.get('leadId'))
    if (!leadId) {
      return actionError('A quotation has to belong to a lead.', {
        leadId: 'Choose the lead this quote is for.',
      })
    }

    const lead = await leadForCommercials(actor, leadId)
    if (!lead) {
      return actionError('That lead is not available.', {
        leadId: 'Choose a lead you can see.',
      })
    }

    if (!lead.vertical.usesQuotations) {
      return actionError(
        `${lead.vertical.name} leads do not use quotations. Turn the quotations module on for the vertical in Master Data if that is wrong.`,
        { leadId: 'This lead’s vertical has no quotations module.' },
      )
    }

    const parsed = quotationSchema.safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const data = parsed.data
    const quoteDate = data.quoteDate ?? new Date()

    if (data.validUntil && data.validUntil < quoteDate) {
      return actionError('The quote expires before it was raised.', {
        validUntil: 'Must be on or after the quote date.',
      })
    }

    // Created empty and priced afterwards. A quotation is a document with
    // lines, and a form that demanded the first line up front would make the
    // common case — three lines, added one at a time while reading an email —
    // into a form the user has to plan before opening.
    const quotation = await auditedTransaction(async (tx) =>
      tx.quotation.create({
        data: {
          quoteNumber: await nextQuotationCode(tx),
          leadId: lead.id,
          quoteDate,
          validUntil: data.validUntil,
          subtotal: 0,
          discount: data.discount ?? 0,
          taxAmount: data.taxAmount ?? 0,
          totalAmount: 0,
          notes: data.notes,
        },
        select: { id: true, quoteNumber: true },
      }),
    )

    createdId = quotation.id
    revalidateLead(lead.id)
    revalidatePath('/quotations')
    return actionSuccess(`${quotation.quoteNumber} created.`)
  })

  // Outside the wrapper: `redirect` throws, and throwing inside the transaction
  // body would roll back the quotation that was just created.
  if (result.status === 'success' && createdId) {
    redirect(`/quotations/${createdId}`)
  }

  return result
}

export async function updateQuotationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.COMMERCIAL_MANAGE, async (actor) => {
    const id = optionalString(formData.get('id'))
    if (!id) return actionError('Missing quotation id.')

    const quotation = await visibleQuotation(actor, id)
    if (!quotation) return actionError('That quotation no longer exists.')

    if (!isQuotationEditable(quotation.status)) {
      return actionError(frozenMessage(quotation))
    }

    const parsed = quotationSchema.safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const data = parsed.data

    // The same check the create path makes. Without it the two entry points to
    // one record disagree about what is valid, and an edit can leave a
    // quotation whose validity ended before it was raised.
    const quoteDate = data.quoteDate ?? quotation.quoteDate
    if (data.validUntil && data.validUntil < quoteDate) {
      return actionError('The quote expires before it was raised.', {
        validUntil: 'Must be on or after the quote date.',
      })
    }

    await auditedTransaction(async (tx) => {
      await tx.quotation.update({
        where: { id: quotation.id },
        data: {
          quoteDate: data.quoteDate ?? undefined,
          validUntil: data.validUntil,
          notes: data.notes,
        },
      })

      await recalculateQuotation(tx, quotation.id, {
        discount: data.discount ?? 0,
        taxAmount: data.taxAmount ?? 0,
      })
    })

    revalidateQuotation(quotation)
    return actionSuccess('Changes saved.')
  })
}

export async function addQuotationItemAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.COMMERCIAL_MANAGE, async (actor) => {
    const quotationId = optionalString(formData.get('quotationId'))
    if (!quotationId) return actionError('Missing quotation id.')

    const quotation = await visibleQuotation(actor, quotationId)
    if (!quotation) return actionError('That quotation no longer exists.')

    if (!isQuotationEditable(quotation.status)) {
      return actionError(frozenMessage(quotation))
    }

    const parsed = itemSchema.safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const data = parsed.data
    const unitPriceCents = toCents(data.unitPrice)

    if (unitPriceCents <= 0) {
      return actionError('Enter a unit price.', {
        unitPrice: 'A priced line needs an amount above zero.',
      })
    }

    await auditedTransaction(async (tx) => {
      await tx.quotationItem.create({
        data: {
          quotationId: quotation.id,
          productId: data.productId,
          description: data.description,
          quantity: data.quantity,
          unitPrice: data.unitPrice ?? 0,
          lineTotal: fromCents(lineTotalCents(data.quantity, data.unitPrice ?? 0)),
        },
      })

      await recalculateQuotation(tx, quotation.id)
    })

    revalidateQuotation(quotation)
    return actionSuccess('Line added.')
  })
}

export async function deleteQuotationItemAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.COMMERCIAL_MANAGE, async (actor) => {
    const id = optionalString(formData.get('id'))
    if (!id) return actionError('Missing line id.')

    const item = await prisma.quotationItem.findUnique({
      where: { id },
      select: { id: true, quotationId: true },
    })
    if (!item) return actionError('That line no longer exists.')

    const quotation = await visibleQuotation(actor, item.quotationId)
    if (!quotation) return actionError('That quotation no longer exists.')

    if (!isQuotationEditable(quotation.status)) {
      return actionError(frozenMessage(quotation))
    }

    await auditedTransaction(async (tx) => {
      await tx.quotationItem.delete({ where: { id: item.id } })
      await recalculateQuotation(tx, quotation.id)
    })

    revalidateQuotation(quotation)
    return actionSuccess('Line removed.')
  })
}

const STATUSES = new Set<string>([
  'DRAFT',
  'SENT',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
])

/**
 * Move a quotation between statuses.
 *
 * Two rules beyond the obvious:
 *
 * **A quotation with no lines cannot be sent or accepted.** A zero-value quote
 * accepted by mistake goes straight into Order Value as nothing, which is worse
 * than an error message — the number is wrong and the row looks finished.
 *
 * **Accepting sets the lead's deal value if it has none.** Product Sales books
 * Won Revenue off `Lead.dealValue` (docs/02 §5), and the accepted quote is the
 * only place that number has ever been agreed. Left to be re-typed later it
 * would be re-typed differently, or not at all, and the vertical would report a
 * won deal worth nothing. It only ever fills a blank — a value somebody set by
 * hand is a decision, and quietly overwriting it would be this action deciding
 * something it was not asked to decide. Setting a deal value is `lead.commercial`
 * in the matrix, so someone holding `commercial.manage` without it still gets
 * the acceptance, and the screen says the deal value was left alone.
 */
export async function setQuotationStatusAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.COMMERCIAL_MANAGE, async (actor) => {
    const id = optionalString(formData.get('id'))
    const status = formData.get('status')

    if (!id) return actionError('Missing quotation id.')
    if (typeof status !== 'string' || !STATUSES.has(status)) {
      return actionError('Choose a status.', { status: 'Choose a status.' })
    }

    const quotation = await visibleQuotation(actor, id)
    if (!quotation) return actionError('That quotation no longer exists.')

    const next = status as QuotationStatus

    if (next === quotation.status) {
      return actionError(
        `${quotation.quoteNumber} is already ${QUOTATION_STATUS_LABELS[next].toLowerCase()}.`,
      )
    }

    // Leaving ACCEPTED once invoices exist would strand real money against a
    // quote the system says was never agreed.
    if (quotation.status === 'ACCEPTED' && next !== 'ACCEPTED') {
      const invoiced = await prisma.invoice.count({
        where: { quotationId: quotation.id, status: { not: 'CANCELLED' } },
      })
      if (invoiced > 0) {
        return actionError(
          `${quotation.quoteNumber} has ${invoiced} invoice${invoiced === 1 ? '' : 's'} raised against it. Cancel those first if the order really did fall through.`,
        )
      }
    }

    if (next === 'SENT' || next === 'ACCEPTED') {
      const lines = await prisma.quotationItem.count({
        where: { quotationId: quotation.id },
      })
      if (lines === 0 || toCents(quotation.totalAmount) <= 0) {
        return actionError(
          `${quotation.quoteNumber} has nothing priced on it yet. Add at least one line first.`,
        )
      }
    }

    let dealValueSet = false

    await auditedTransaction(async (tx) => {
      await tx.quotation.update({
        where: { id: quotation.id },
        data: { status: next },
      })

      if (
        next === 'ACCEPTED' &&
        quotation.lead.dealValue === null &&
        (await can(actor, PERMISSIONS.LEAD_COMMERCIAL))
      ) {
        await tx.lead.update({
          where: { id: quotation.leadId },
          data: { dealValue: quotation.totalAmount },
        })
        dealValueSet = true
      }

      await recordAudit({
        entityType: 'QUOTATION',
        entityId: quotation.id,
        action: next === 'ACCEPTED' ? 'WON' : 'UPDATE',
        fieldName: 'status',
        oldValue: quotation.status,
        newValue: next,
        userId: actor.id,
      })
    })

    revalidateQuotation(quotation)
    return actionSuccess(
      dealValueSet
        ? `${quotation.quoteNumber} accepted, and the lead's deal value set from it.`
        : `${quotation.quoteNumber} marked ${QUOTATION_STATUS_LABELS[next].toLowerCase()}.`,
    )
  })
}

/**
 * Delete a quotation.
 *
 * Only while it is a draft nobody has billed against. Anything further along is
 * a document that left the building, and the honest way to withdraw one is to
 * mark it rejected — which keeps it in the record of what was offered.
 */
export async function deleteQuotationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let leadId: string | null = null

  const result = await withAudit(PERMISSIONS.COMMERCIAL_MANAGE, async (actor) => {
    const id = optionalString(formData.get('id'))
    if (!id) return actionError('Missing quotation id.')

    const quotation = await visibleQuotation(actor, id)
    if (!quotation) return actionError('That quotation no longer exists.')

    if (quotation.status !== 'DRAFT') {
      return actionError(
        `${quotation.quoteNumber} has been ${QUOTATION_STATUS_LABELS[quotation.status].toLowerCase()}, so it stays in the record. Mark it rejected if the offer is off the table.`,
      )
    }

    const invoiced = await prisma.invoice.count({
      where: { quotationId: quotation.id },
    })
    if (invoiced > 0) {
      return actionError(
        `${quotation.quoteNumber} has invoices against it and cannot be deleted.`,
      )
    }

    await auditedTransaction(async (tx) => {
      await tx.quotationItem.deleteMany({ where: { quotationId: quotation.id } })
      await tx.quotation.delete({ where: { id: quotation.id } })
    })

    leadId = quotation.leadId
    revalidateQuotation(quotation)
    return actionSuccess(`${quotation.quoteNumber} deleted.`)
  })

  if (result.status === 'success' && leadId) {
    redirect(`/leads/${leadId}/quotations`)
  }

  return result
}

function frozenMessage(quotation: {
  quoteNumber: string
  status: QuotationStatus
}): string {
  return `${quotation.quoteNumber} has been ${QUOTATION_STATUS_LABELS[quotation.status].toLowerCase()} and its figures are fixed. Raise a new quotation rather than rewriting one the client has already seen.`
}

function revalidateLead(leadId: string) {
  revalidatePath(`/leads/${leadId}`)
  revalidatePath(`/leads/${leadId}/quotations`)
}

function revalidateQuotation(quotation: { id: string; leadId: string }) {
  revalidatePath('/quotations')
  revalidatePath(`/quotations/${quotation.id}`)
  revalidateLead(quotation.leadId)
}
