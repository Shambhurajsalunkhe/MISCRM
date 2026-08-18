'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { prisma } from '@/lib/db'
import { withAudit } from '@/lib/action'
import { PERMISSIONS } from '@/lib/permissions'
import { leadForCommercials } from '@/lib/commercials/access'
import { PAYMENT_MODES } from '@/lib/commercials/display'
import {
  amendInvoice,
  deletePayment,
  raiseInvoice,
  recordPayment,
  setInvoiceCancelled,
  type InvoiceSource,
} from '@/lib/commercials/invoice'
import { sweepOverdueInvoices } from '@/lib/commercials/overdue'
import { leadChildVisibilityFilter } from '@/lib/visibility'
import { optionalDate, optionalMoney, optionalText } from '@/lib/form-fields'
import {
  actionError,
  actionSuccess,
  formValues,
  fromZodError,
  optionalString,
  type ActionState,
} from '@/lib/form'
import type { CurrentUser } from '@/lib/auth/session'
import type { PaymentMode } from '@/generated/prisma/enums'

/**
 * Invoices and payments (README §19).
 *
 * The arithmetic all lives in `src/lib/commercials/invoice.ts`; this file is the
 * door — permission, scope, and turning a form into that module's input. The
 * split matters because the same engine has to be callable from a future
 * importer or a report without re-implementing "may this person do it".
 *
 * Two permissions, deliberately different (docs/03 §2): raising and amending an
 * invoice is `commercial.manage` and recording a payment is
 * `commercial.payment`. Both now sit with the BDM: the Manager tier that used to
 * hold the second one was removed (D13), so the separation between asking for
 * money and recording its arrival is no longer enforced by role. The two
 * permissions stay distinct so it can be re-drawn from /admin/permissions
 * without a deployment.
 */

const invoiceSchema = z.object({
  invoiceDate: optionalDate,
  dueDate: optionalDate,
  amount: optionalMoney,
  taxAmount: optionalMoney,
  notes: optionalText(4000),
})

const paymentSchema = z.object({
  amount: optionalMoney,
  paymentDate: optionalDate,
  referenceNumber: optionalText(120),
  notes: optionalText(1000),
})

async function visibleInvoice(user: CurrentUser, id: string) {
  return prisma.invoice.findFirst({
    where: { id, ...(await leadChildVisibilityFilter(user)) },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      leadId: true,
      clientId: true,
    },
  })
}

/**
 * Read the source out of the form.
 *
 * One `<select>` carrying a `kind:id` pair rather than three nullable fields:
 * the schema allows exactly one parent (docs/01 §3), and three separate inputs
 * would make "exactly one" something the form and the action each had to
 * enforce separately.
 */
function sourceFromForm(formData: FormData): InvoiceSource | null {
  const raw = optionalString(formData.get('source'))
  if (!raw || raw === 'lead') return { kind: 'lead' }

  const [kind, id] = raw.split(':')
  if (!id) return null

  if (kind === 'contract' || kind === 'quotation' || kind === 'placement') {
    return { kind, id }
  }

  return null
}

export async function raiseInvoiceAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let createdId: string | null = null

  const result = await withAudit(PERMISSIONS.COMMERCIAL_MANAGE, async (actor) => {
    const leadId = optionalString(formData.get('leadId'))
    if (!leadId) {
      return actionError('An invoice has to belong to a lead.', {
        leadId: 'Choose the lead this invoice is for.',
      })
    }

    const lead = await leadForCommercials(actor, leadId)
    if (!lead) {
      return actionError('That lead is not available.', {
        leadId: 'Choose a lead you can see.',
      })
    }

    const source = sourceFromForm(formData)
    if (!source) {
      return actionError('That is not something an invoice can be raised against.', {
        source: 'Choose what this invoice bills for.',
      })
    }

    const parsed = invoiceSchema.safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const data = parsed.data
    const invoiceDate = data.invoiceDate ?? new Date()

    if (data.dueDate && data.dueDate < invoiceDate) {
      return actionError('The invoice is due before it was raised.', {
        dueDate: 'Must be on or after the invoice date.',
      })
    }

    const outcome = await raiseInvoice({
      leadId: lead.id,
      source,
      invoiceDate,
      dueDate: data.dueDate,
      amount: data.amount ?? 0,
      taxAmount: data.taxAmount ?? 0,
      notes: data.notes,
      actorId: actor.id,
    })

    if (!outcome.ok) {
      return actionError(
        outcome.message,
        outcome.field ? { [outcome.field]: outcome.message } : undefined,
      )
    }

    createdId = outcome.id
    revalidateInvoice({ id: outcome.id, leadId: lead.id, clientId: lead.clientId })
    return actionSuccess(`${outcome.invoiceNumber} raised.`)
  })

  // Outside the wrapper: `redirect` throws, and throwing inside the transaction
  // body would roll back the invoice that was just raised.
  if (result.status === 'success' && createdId) {
    redirect(`/invoices/${createdId}`)
  }

  return result
}

export async function amendInvoiceAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.COMMERCIAL_MANAGE, async (actor) => {
    const id = optionalString(formData.get('id'))
    if (!id) return actionError('Missing invoice id.')

    const invoice = await visibleInvoice(actor, id)
    if (!invoice) return actionError('That invoice no longer exists.')

    const parsed = invoiceSchema.safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const data = parsed.data
    const invoiceDate = data.invoiceDate ?? new Date()

    if (data.dueDate && data.dueDate < invoiceDate) {
      return actionError('The invoice is due before it was raised.', {
        dueDate: 'Must be on or after the invoice date.',
      })
    }

    const outcome = await amendInvoice({
      invoiceId: invoice.id,
      invoiceDate,
      dueDate: data.dueDate,
      amount: data.amount,
      taxAmount: data.taxAmount,
      notes: data.notes,
    })

    if (!outcome.ok) {
      return actionError(
        outcome.message,
        outcome.field ? { [outcome.field]: outcome.message } : undefined,
      )
    }

    revalidateInvoice(invoice)
    return actionSuccess(`${outcome.invoiceNumber} updated.`)
  })
}

export async function setInvoiceCancelledAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.COMMERCIAL_MANAGE, async (actor) => {
    const id = optionalString(formData.get('id'))
    if (!id) return actionError('Missing invoice id.')

    const invoice = await visibleInvoice(actor, id)
    if (!invoice) return actionError('That invoice no longer exists.')

    const cancelled = formData.get('cancelled') === 'true'

    const outcome = await setInvoiceCancelled({
      invoiceId: invoice.id,
      cancelled,
      actorId: actor.id,
    })

    if (!outcome.ok) return actionError(outcome.message)

    revalidateInvoice(invoice)
    return actionSuccess(
      cancelled
        ? `${outcome.invoiceNumber} cancelled. It no longer counts towards Pending Revenue.`
        : `${outcome.invoiceNumber} reinstated.`,
    )
  })
}

export async function recordPaymentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.COMMERCIAL_PAYMENT, async (actor) => {
    const invoiceId = optionalString(formData.get('invoiceId'))
    if (!invoiceId) return actionError('Missing invoice id.')

    const invoice = await visibleInvoice(actor, invoiceId)
    if (!invoice) return actionError('That invoice no longer exists.')

    const parsed = paymentSchema.safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const mode = formData.get('mode')
    if (
      typeof mode !== 'string' ||
      !PAYMENT_MODES.includes(mode as PaymentMode)
    ) {
      return actionError('Choose how the money arrived.', {
        mode: 'Choose a payment method.',
      })
    }

    const data = parsed.data
    if (data.amount === null || data.amount <= 0) {
      return actionError('Enter the amount received.', {
        amount: 'Enter an amount above zero.',
      })
    }

    const outcome = await recordPayment({
      invoiceId: invoice.id,
      amount: data.amount,
      paymentDate: data.paymentDate ?? new Date(),
      mode: mode as PaymentMode,
      referenceNumber: data.referenceNumber,
      notes: data.notes,
      actorId: actor.id,
    })

    if (!outcome.ok) {
      return actionError(
        outcome.message,
        outcome.field ? { [outcome.field]: outcome.message } : undefined,
      )
    }

    // A receipt belongs on the deal's timeline as well as the invoice — it is
    // the event an account manager is waiting for, and the lead is where they
    // look. `PAYMENT` is one of the activity types the application writes and
    // nobody can compose by hand (src/lib/activity-types.ts).
    await prisma.activity.create({
      data: {
        type: 'PAYMENT',
        subject: `Payment received against ${outcome.invoiceNumber}`,
        notes: data.referenceNumber ? `Reference: ${data.referenceNumber}` : null,
        activityDate: data.paymentDate ?? new Date(),
        userId: actor.id,
        leadId: invoice.leadId,
      },
    })

    revalidateInvoice(invoice)
    return actionSuccess(
      outcome.status === 'PAID'
        ? `${outcome.invoiceNumber} is now paid in full.`
        : `Payment recorded. ${outcome.invoiceNumber} still has ${outcome.amountPending.toFixed(2)} outstanding.`,
    )
  })
}

export async function deletePaymentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.COMMERCIAL_PAYMENT, async (actor) => {
    const id = optionalString(formData.get('id'))
    if (!id) return actionError('Missing payment id.')

    // Scoped through the invoice, which is scoped through the lead — a payment
    // id in a form field is no more trustworthy than any other.
    const payment = await prisma.payment.findFirst({
      where: { id, invoice: await leadChildVisibilityFilter(actor) },
      select: { id: true, invoiceId: true },
    })
    if (!payment) return actionError('That payment no longer exists.')

    const invoice = await visibleInvoice(actor, payment.invoiceId)
    if (!invoice) return actionError('That invoice no longer exists.')

    const outcome = await deletePayment({
      paymentId: payment.id,
      actorId: actor.id,
    })

    if (!outcome.ok) return actionError(outcome.message)

    revalidateInvoice(invoice)
    return actionSuccess(
      `Receipt removed. ${outcome.invoiceNumber} now shows ${outcome.amountPending.toFixed(2)} outstanding.`,
    )
  })
}

/**
 * Run the overdue sweep by hand.
 *
 * The endpoint at /api/jobs/overdue-invoices is what a scheduler calls; this is
 * the same function behind a button, so an administrator can align the stored
 * statuses without waiting for a nightly run. Idempotent either way.
 */
export async function sweepOverdueAction(
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ADMIN_MASTER, async () => {
    const result = await sweepOverdueInvoices()

    revalidatePath('/invoices')
    return actionSuccess(
      `${result.markedOverdue} invoice${result.markedOverdue === 1 ? '' : 's'} marked overdue, ${result.clearedOverdue} cleared.`,
    )
  })
}

function revalidateInvoice(invoice: {
  id: string
  leadId: string
  clientId: string
}) {
  revalidatePath('/invoices')
  revalidatePath(`/invoices/${invoice.id}`)
  revalidatePath(`/leads/${invoice.leadId}`)
  revalidatePath(`/leads/${invoice.leadId}/commercials`)
  revalidatePath(`/leads/${invoice.leadId}/timeline`)
  revalidatePath(`/clients/${invoice.clientId}`)
}
