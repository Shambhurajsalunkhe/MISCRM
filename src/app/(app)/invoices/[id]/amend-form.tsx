'use client'

import { useActionState, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { IDLE } from '@/lib/form'
import { amendInvoiceAction } from '../actions'

/**
 * Correct an invoice.
 *
 * Amounts lock once anything has been received: a client who has paid against a
 * number has agreed to that number, and editing it would leave a receipt larger
 * than the invoice it belongs to. Dates and notes stay open throughout, because
 * correcting a due date is how an invoice stops being wrongly overdue — and
 * that correction is often the whole reason someone opened this form.
 */
export function AmendInvoiceForm({
  invoiceId,
  invoiceDate,
  dueDate,
  amount,
  taxAmount,
  notes,
  amountsLocked,
  currencySymbol,
}: {
  invoiceId: string
  invoiceDate: string
  dueDate: string
  amount: string
  taxAmount: string
  notes: string | null
  amountsLocked: boolean
  currencySymbol: string
}) {
  const [state, formAction] = useActionState(amendInvoiceAction, IDLE)
  const [open, setOpen] = useState(false)
  const errors = state.fieldErrors ?? {}

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Amend
      </Button>
    )
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={invoiceId} />

      <FormMessage state={state} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Invoice date"
          htmlFor="invoiceDate"
          error={errors.invoiceDate}
        >
          <Input
            id="invoiceDate"
            name="invoiceDate"
            type="date"
            defaultValue={invoiceDate}
          />
        </Field>

        <Field
          label="Due date"
          htmlFor="dueDate"
          hint="Blank means the invoice never falls overdue."
          error={errors.dueDate}
        >
          <Input
            id="dueDate"
            name="dueDate"
            type="date"
            defaultValue={dueDate}
          />
        </Field>

        <Field
          label={`Amount (${currencySymbol})`}
          htmlFor="amount"
          hint={
            amountsLocked
              ? 'Fixed — money has been received against this invoice.'
              : undefined
          }
          error={errors.amount}
        >
          <Input
            id="amount"
            name="amount"
            inputMode="decimal"
            defaultValue={amount}
            disabled={amountsLocked}
          />
        </Field>

        <Field
          label={`Tax (${currencySymbol})`}
          htmlFor="taxAmount"
          error={errors.taxAmount}
        >
          <Input
            id="taxAmount"
            name="taxAmount"
            inputMode="decimal"
            defaultValue={taxAmount}
            disabled={amountsLocked}
          />
        </Field>
      </div>

      <Field label="Notes" htmlFor="notes" error={errors.notes}>
        <Textarea
          id="notes"
          name="notes"
          rows={3}
          maxLength={4000}
          defaultValue={notes ?? ''}
        />
      </Field>

      <div className="flex gap-2">
        <SubmitButton size="sm">Save</SubmitButton>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
