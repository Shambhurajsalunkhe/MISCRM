'use client'

import { useActionState, useEffect, useRef, useState } from 'react'

import { Button, ButtonLink } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { IDLE } from '@/lib/form'
import { submitCandidateAction } from '../actions'

export type CandidateOption = {
  id: string
  label: string
}

/**
 * Put a candidate forward for this requirement.
 *
 * The picker lists the candidate master rather than offering a "new candidate"
 * shortcut, which is decision D9 showing through: the same person submitted to
 * three clients has to be one candidate and three submissions, or Candidates
 * Sourced counts them three times. Adding someone genuinely new is a link to
 * the master, not a second creation path that would make duplicates the easy
 * option.
 */
export function SubmitCandidate({
  requirementId,
  candidates,
  currencySymbol,
  truncated,
}: {
  requirementId: string
  candidates: CandidateOption[]
  currencySymbol: string
  truncated: boolean
}) {
  const [state, formAction] = useActionState(submitCandidateAction, IDLE)
  const [open, setOpen] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const errors = state.fieldErrors ?? {}

  // Close and clear once submitted, so the obvious next action — put another
  // profile forward — does not start from a form that looks already filled in.
  useEffect(() => {
    if (state.status === 'success') {
      formRef.current?.reset()
      setOpen(false)
    }
  }, [state])

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Submit candidate
      </Button>
    )
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3"
    >
      <input type="hidden" name="requirementId" value={requirementId} />

      <FormMessage state={state} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Candidate"
          htmlFor="candidateId"
          hint={
            truncated
              ? 'The 500 most recently added. Search the candidate master for anyone older.'
              : undefined
          }
          error={errors.candidateId}
          required
          className="sm:col-span-2"
        >
          <Select id="candidateId" name="candidateId" defaultValue="" required>
            <option value="">Choose a candidate</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={`Offered salary (${currencySymbol})`}
          htmlFor="offeredSalary"
          hint="Optional now; needed when the offer is actually made."
          error={errors.offeredSalary}
        >
          <Input id="offeredSalary" name="offeredSalary" inputMode="decimal" />
        </Field>

        <Field
          label={`Bill rate (${currencySymbol})`}
          htmlFor="billRate"
          error={errors.billRate}
        >
          <Input id="billRate" name="billRate" inputMode="decimal" />
        </Field>

        <Field label="Note" htmlFor="submit-note" className="sm:col-span-2">
          <Input
            id="submit-note"
            name="note"
            placeholder="Why this profile fits"
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton size="sm">Submit</SubmitButton>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
        <ButtonLink href="/candidates/new" variant="ghost" size="sm">
          Add to the candidate master
        </ButtonLink>
      </div>
    </form>
  )
}
