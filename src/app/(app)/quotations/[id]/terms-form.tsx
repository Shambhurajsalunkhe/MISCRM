'use client'

import { useActionState, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { IDLE } from '@/lib/form'
import { updateQuotationAction } from '../actions'

/**
 * Dates, discount, tax and notes — everything on a quotation that is typed
 * rather than summed.
 *
 * Discount and tax post through the same action as the dates because changing
 * either has to recompute the total, and a form that saved them separately
 * would leave a window in which the header disagreed with its own lines.
 */
export function QuotationTermsForm({
  quotationId,
  quoteDate,
  validUntil,
  discount,
  taxAmount,
  notes,
  currencySymbol,
}: {
  quotationId: string
  quoteDate: string
  validUntil: string
  discount: string
  taxAmount: string
  notes: string | null
  currencySymbol: string
}) {
  const [state, formAction] = useActionState(updateQuotationAction, IDLE)
  const [open, setOpen] = useState(false)
  const errors = state.fieldErrors ?? {}

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Edit terms
      </Button>
    )
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={quotationId} />

      <FormMessage state={state} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Quote date" htmlFor="quoteDate" error={errors.quoteDate}>
          <Input
            id="quoteDate"
            name="quoteDate"
            type="date"
            defaultValue={quoteDate}
          />
        </Field>

        <Field
          label="Valid until"
          htmlFor="validUntil"
          error={errors.validUntil}
        >
          <Input
            id="validUntil"
            name="validUntil"
            type="date"
            defaultValue={validUntil}
          />
        </Field>

        <Field
          label={`Discount (${currencySymbol})`}
          htmlFor="discount"
          error={errors.discount}
        >
          <Input
            id="discount"
            name="discount"
            inputMode="decimal"
            defaultValue={discount}
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
