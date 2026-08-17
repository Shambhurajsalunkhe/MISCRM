'use client'

import { useActionState, useState } from 'react'

import { Button, ButtonLink } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { Card } from '@/components/ui/page'
import { LeadPicker } from '@/components/commercials/lead-picker'
import {
  BILLING_CYCLE_LABELS,
  BILLING_CYCLES,
} from '@/lib/commercials/display'
import type { CommercialLeadOption } from '@/lib/commercials/options'
import { IDLE } from '@/lib/form'
import type { BillingCycle } from '@/generated/prisma/enums'
import { createContractAction, updateContractAction } from './actions'

export type ContractDefaults = {
  id: string
  contractValue: string
  billingCycle: BillingCycle
  startDate: string
  endDate: string
  signedDate: string
  notes: string | null
}

/**
 * One form for raising a contract and for amending one.
 *
 * The same component both times, for the reason `RequirementForm` gives: two
 * forms drift, and the pair that drifts is always the one where the create
 * screen validates something the edit screen does not.
 */
export function ContractForm({
  mode,
  leads,
  lockedLead,
  truncated,
  defaults,
  currencySymbol,
  cancelHref,
}: {
  mode: 'create' | 'edit'
  leads?: CommercialLeadOption[]
  lockedLead?: CommercialLeadOption
  truncated?: boolean
  defaults?: ContractDefaults
  currencySymbol: string
  cancelHref: string
}) {
  const [state, formAction] = useActionState(
    mode === 'create' ? createContractAction : updateContractAction,
    IDLE,
  )
  const [open, setOpen] = useState(mode === 'create')
  const errors = state.fieldErrors ?? {}

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Edit contract
      </Button>
    )
  }

  const body = (
    <div className="space-y-4">
      {mode === 'create' ? (
        <LeadPicker
          leads={leads ?? []}
          lockedLead={lockedLead}
          truncated={truncated}
          error={errors.leadId}
        />
      ) : (
        <input type="hidden" name="id" value={defaults?.id ?? ''} />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={`Contract value (${currencySymbol})`}
          htmlFor="contractValue"
          required
          hint="The whole engagement, not one instalment."
          error={errors.contractValue}
        >
          <Input
            id="contractValue"
            name="contractValue"
            inputMode="decimal"
            required
            defaultValue={defaults?.contractValue ?? ''}
          />
        </Field>

        <Field
          label="Billing cycle"
          htmlFor="billingCycle"
          hint="How often an invoice comes off this contract."
          error={errors.billingCycle}
        >
          <Select
            id="billingCycle"
            name="billingCycle"
            defaultValue={defaults?.billingCycle ?? 'ONE_TIME'}
          >
            {BILLING_CYCLES.map((cycle) => (
              <option key={cycle} value={cycle}>
                {BILLING_CYCLE_LABELS[cycle]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Start date" htmlFor="startDate" error={errors.startDate}>
          <Input
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={defaults?.startDate ?? ''}
          />
        </Field>

        <Field label="End date" htmlFor="endDate" error={errors.endDate}>
          <Input
            id="endDate"
            name="endDate"
            type="date"
            defaultValue={defaults?.endDate ?? ''}
          />
        </Field>

        <Field
          label="Signed on"
          htmlFor="signedDate"
          hint="Filling this in marks the contract signed."
          error={errors.signedDate}
        >
          <Input
            id="signedDate"
            name="signedDate"
            type="date"
            defaultValue={defaults?.signedDate ?? ''}
          />
        </Field>
      </div>

      <Field label="Notes" htmlFor="notes" error={errors.notes}>
        <Textarea
          id="notes"
          name="notes"
          rows={3}
          maxLength={4000}
          defaultValue={defaults?.notes ?? ''}
        />
      </Field>
    </div>
  )

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      {mode === 'create' ? <Card title="Contract">{body}</Card> : body}

      <div className="flex gap-2">
        <SubmitButton size={mode === 'create' ? 'md' : 'sm'}>
          {mode === 'create' ? 'Create contract' : 'Save'}
        </SubmitButton>
        {mode === 'create' ? (
          <ButtonLink href={cancelHref} variant="secondary">
            Cancel
          </ButtonLink>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}
