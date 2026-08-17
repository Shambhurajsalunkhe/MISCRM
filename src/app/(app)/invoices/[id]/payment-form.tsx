'use client'

import { useActionState, useEffect, useRef } from 'react'

import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import {
  PAYMENT_MODE_LABELS,
  PAYMENT_MODES,
} from '@/lib/commercials/display'
import { IDLE } from '@/lib/form'
import { recordPaymentAction } from '../actions'

/**
 * Record a receipt against an invoice.
 *
 * The outstanding amount is the default, because part-payments are the
 * exception and the closing payment is the common case. It stays editable — an
 * instalment is a perfectly ordinary thing to enter — but the form should not
 * make the usual answer the one that needs typing.
 */
export function PaymentForm({
  invoiceId,
  outstanding,
  currencySymbol,
}: {
  invoiceId: string
  outstanding: string
  currencySymbol: string
}) {
  const [state, formAction] = useActionState(recordPaymentAction, IDLE)
  const formRef = useRef<HTMLFormElement>(null)
  const errors = state.fieldErrors ?? {}

  useEffect(() => {
    if (state.status === 'success') formRef.current?.reset()
  }, [state])

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <input type="hidden" name="invoiceId" value={invoiceId} />

      <FormMessage state={state} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={`Amount (${currencySymbol})`}
          htmlFor="amount"
          required
          error={errors.amount}
        >
          <Input
            id="amount"
            name="amount"
            inputMode="decimal"
            required
            defaultValue={outstanding}
          />
        </Field>

        <Field
          label="Received on"
          htmlFor="paymentDate"
          hint="Defaults to today."
          error={errors.paymentDate}
        >
          <Input id="paymentDate" name="paymentDate" type="date" />
        </Field>

        <Field label="Method" htmlFor="mode" error={errors.mode}>
          <Select id="mode" name="mode" defaultValue="BANK_TRANSFER">
            {PAYMENT_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {PAYMENT_MODE_LABELS[mode]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Reference"
          htmlFor="referenceNumber"
          hint="Transaction or cheque number."
          error={errors.referenceNumber}
        >
          <Input id="referenceNumber" name="referenceNumber" maxLength={120} />
        </Field>
      </div>

      <Field label="Notes" htmlFor="notes" error={errors.notes}>
        <Textarea id="notes" name="notes" rows={2} maxLength={1000} />
      </Field>

      <SubmitButton size="sm">Record payment</SubmitButton>
    </form>
  )
}
