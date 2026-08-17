'use client'

import { useActionState, useState } from 'react'

import { Field, Select } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import {
  QUOTATION_STATUS_LABELS,
  QUOTATION_STATUSES,
} from '@/lib/commercials/display'
import { IDLE } from '@/lib/form'
import type { QuotationStatus } from '@/generated/prisma/enums'
import { setQuotationStatusAction } from '../actions'

/**
 * Move a quotation between statuses.
 *
 * The consequences are spelled out beside the control rather than left to be
 * discovered: accepting freezes the figures and can set the lead's deal value,
 * which is the difference between a dropdown and a decision.
 */
export function QuotationStatusControl({
  quotationId,
  status,
  leadHasDealValue,
}: {
  quotationId: string
  status: QuotationStatus
  leadHasDealValue: boolean
}) {
  const [state, formAction] = useActionState(setQuotationStatusAction, IDLE)
  const [next, setNext] = useState<QuotationStatus>(status)

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={quotationId} />

      <FormMessage state={state} />

      <Field label="Status" htmlFor="status">
        <Select
          id="status"
          name="status"
          value={next}
          onChange={(event) => setNext(event.target.value as QuotationStatus)}
        >
          {QUOTATION_STATUSES.map((value) => (
            <option key={value} value={value}>
              {QUOTATION_STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
      </Field>

      {next === 'ACCEPTED' && status !== 'ACCEPTED' ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Accepting fixes the lines and the total — a change after this means a
          new quotation.
          {leadHasDealValue
            ? ' The lead already has a deal value, which is left as it is.'
            : ' The lead has no deal value yet, so it will be set from this total.'}
        </p>
      ) : null}

      <SubmitButton size="sm" disabled={next === status}>
        Update status
      </SubmitButton>

      {status === 'ACCEPTED' && next !== 'ACCEPTED' ? (
        <p className="text-xs text-slate-500">
          Moving away from Accepted is refused while invoices exist against this
          quotation.
        </p>
      ) : null}
    </form>
  )
}
