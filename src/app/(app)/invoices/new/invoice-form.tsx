'use client'

import { useActionState, useState } from 'react'

import { ButtonLink } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { Card } from '@/components/ui/page'
import { LeadPicker } from '@/components/commercials/lead-picker'
import type {
  CommercialLeadOption,
  InvoiceSourceOption,
} from '@/lib/commercials/options'
import { IDLE } from '@/lib/form'
import { raiseInvoiceAction } from '../actions'

/**
 * Raise an invoice.
 *
 * Choosing what it bills for fills the amount from that record — a placement's
 * value, a quote's total, a contract's value — because that is the number in
 * almost every case, and re-typing it is how an invoice ends up disagreeing
 * with the thing it bills. It stays an ordinary editable field: a quarterly
 * retainer bills a quarter of its contract, and the form should not fight that.
 */
export function InvoiceForm({
  leads,
  lockedLead,
  truncated,
  sources,
  defaultSource,
  currencySymbol,
  cancelHref,
}: {
  leads: CommercialLeadOption[]
  lockedLead?: CommercialLeadOption
  truncated?: boolean
  sources: InvoiceSourceOption[]
  defaultSource?: string
  currencySymbol: string
  cancelHref: string
}) {
  const [state, formAction] = useActionState(raiseInvoiceAction, IDLE)
  const errors = state.fieldErrors ?? {}

  const initial =
    sources.find((source) => source.value === defaultSource) ?? sources[0]

  const [source, setSource] = useState(initial?.value ?? 'lead')
  const [amount, setAmount] = useState(initial?.amount ?? '')

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <Card title="Invoice">
        <div className="space-y-4">
          <LeadPicker
            leads={leads}
            lockedLead={lockedLead}
            truncated={truncated}
            error={errors.leadId}
          />

          {lockedLead ? (
            <Field
              label="Bills for"
              htmlFor="source"
              hint="Picking one fills the amount from it. Change the amount if you are billing part of it."
              error={errors.source}
            >
              <Select
                id="source"
                name="source"
                value={source}
                onChange={(event) => {
                  const next = event.target.value
                  setSource(next)
                  const picked = sources.find((item) => item.value === next)
                  setAmount(picked?.amount ?? '')
                }}
              >
                {sources.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <input type="hidden" name="source" value="lead" />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={`Amount (${currencySymbol})`}
              htmlFor="amount"
              required
              hint="Before tax."
              error={errors.amount}
            >
              <Input
                id="amount"
                name="amount"
                inputMode="decimal"
                required
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </Field>

            <Field
              label={`Tax (${currencySymbol})`}
              htmlFor="taxAmount"
              error={errors.taxAmount}
            >
              <Input id="taxAmount" name="taxAmount" inputMode="decimal" />
            </Field>

            <Field
              label="Invoice date"
              htmlFor="invoiceDate"
              hint="Defaults to today."
              error={errors.invoiceDate}
            >
              <Input id="invoiceDate" name="invoiceDate" type="date" />
            </Field>

            <Field
              label="Due date"
              htmlFor="dueDate"
              hint="What the overdue sweep measures against. Leave blank for no due date."
              error={errors.dueDate}
            >
              <Input id="dueDate" name="dueDate" type="date" />
            </Field>
          </div>

          <Field label="Notes" htmlFor="notes" error={errors.notes}>
            <Textarea id="notes" name="notes" rows={3} maxLength={4000} />
          </Field>
        </div>
      </Card>

      <div className="flex gap-2">
        <SubmitButton>Raise invoice</SubmitButton>
        <ButtonLink href={cancelHref} variant="secondary">
          Cancel
        </ButtonLink>
      </div>
    </form>
  )
}
