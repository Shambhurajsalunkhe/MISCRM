'use client'

import { useActionState, useState } from 'react'

import { Field, Select } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import {
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUSES,
} from '@/lib/commercials/display'
import { IDLE } from '@/lib/form'
import type { ContractStatus } from '@/generated/prisma/enums'
import { setContractStatusAction } from '../actions'

export function ContractStatusControl({
  contractId,
  status,
  hasSignedDate,
}: {
  contractId: string
  status: ContractStatus
  hasSignedDate: boolean
}) {
  const [state, formAction] = useActionState(setContractStatusAction, IDLE)
  const [next, setNext] = useState<ContractStatus>(status)

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={contractId} />

      <FormMessage state={state} />

      <Field label="Status" htmlFor="status">
        <Select
          id="status"
          name="status"
          value={next}
          onChange={(event) => setNext(event.target.value as ContractStatus)}
        >
          {CONTRACT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {CONTRACT_STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
      </Field>

      {next === 'SIGNED' && !hasSignedDate ? (
        <p className="text-xs text-slate-500">
          Today&rsquo;s date will be recorded as the signing date. Set a
          different one under Terms if the contract was signed earlier.
        </p>
      ) : null}

      <SubmitButton size="sm" disabled={next === status}>
        Update status
      </SubmitButton>
    </form>
  )
}
