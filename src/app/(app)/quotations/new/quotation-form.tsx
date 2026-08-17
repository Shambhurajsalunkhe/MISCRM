'use client'

import { useActionState } from 'react'

import { ButtonLink } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { Card } from '@/components/ui/page'
import { LeadPicker } from '@/components/commercials/lead-picker'
import type { CommercialLeadOption } from '@/lib/commercials/options'
import { IDLE } from '@/lib/form'
import { createQuotationAction } from '../actions'

/**
 * Raise a quotation.
 *
 * Deliberately short: a quotation is a header plus lines, and the lines are
 * added on the detail page where the running total is visible as they go in.
 * Asking for the first line here would mean pricing before the document exists,
 * and the common case — three lines typed while reading an email — would become
 * a form the user has to plan before opening.
 */
export function QuotationForm({
  leads,
  lockedLead,
  truncated,
  currencySymbol,
  cancelHref,
}: {
  leads: CommercialLeadOption[]
  lockedLead?: CommercialLeadOption
  truncated?: boolean
  currencySymbol: string
  cancelHref: string
}) {
  const [state, formAction] = useActionState(createQuotationAction, IDLE)
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <Card title="Quotation">
        <div className="space-y-4">
          <LeadPicker
            leads={leads}
            lockedLead={lockedLead}
            truncated={truncated}
            error={errors.leadId}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Quote date"
              htmlFor="quoteDate"
              hint="Defaults to today."
              error={errors.quoteDate}
            >
              <Input id="quoteDate" name="quoteDate" type="date" />
            </Field>

            <Field
              label="Valid until"
              htmlFor="validUntil"
              hint="When the price stops standing."
              error={errors.validUntil}
            >
              <Input id="validUntil" name="validUntil" type="date" />
            </Field>

            <Field
              label={`Discount (${currencySymbol})`}
              htmlFor="discount"
              hint="Off the line total, not a percentage."
              error={errors.discount}
            >
              <Input id="discount" name="discount" inputMode="decimal" />
            </Field>

            <Field
              label={`Tax (${currencySymbol})`}
              htmlFor="taxAmount"
              error={errors.taxAmount}
            >
              <Input id="taxAmount" name="taxAmount" inputMode="decimal" />
            </Field>
          </div>

          <Field label="Notes" htmlFor="notes" error={errors.notes}>
            <Textarea id="notes" name="notes" rows={3} maxLength={4000} />
          </Field>
        </div>
      </Card>

      <div className="flex gap-2">
        <SubmitButton>Create quotation</SubmitButton>
        <ButtonLink href={cancelHref} variant="secondary">
          Cancel
        </ButtonLink>
      </div>
    </form>
  )
}
