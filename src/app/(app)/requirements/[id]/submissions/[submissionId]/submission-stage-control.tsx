'use client'

import { useActionState, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { IDLE } from '@/lib/form'
import { changeSubmissionStageAction } from '../../../actions'

export type SubmissionStageChoice = {
  id: string
  name: string
  sortOrder: number
  isPlaced: boolean
  isRejected: boolean
}

/**
 * Move a candidate along the requirement's board.
 *
 * The joined stage grows a commercial section, because joining is the moment a
 * staffing deal becomes revenue (decision D8) and the numbers are only known
 * then. Joining date and placement value are both required — the server refuses
 * without them, and `Placement.placementValue` is not nullable on purpose: a
 * placement worth nothing and a placement nobody valued would be
 * indistinguishable, and Won Revenue would under-report the second kind.
 *
 * The two things this control will not do are as deliberate as the ones it
 * will. It cannot un-place a candidate — that is booked revenue, and reversing
 * it is Phase 5's business to define. And it does not offer the joined stage at
 * all once every opening is filled, because the requirement has no room left.
 */
export function SubmissionStageControl({
  submissionId,
  stages,
  currentStageId,
  currencySymbol,
  offeredSalary,
  billRate,
  placed,
  openingsLeft,
}: {
  submissionId: string
  stages: SubmissionStageChoice[]
  currentStageId: string
  currencySymbol: string
  offeredSalary: string | null
  billRate: string | null
  /** True once a placement exists against this submission. */
  placed: boolean
  openingsLeft: number
}) {
  const [state, formAction] = useActionState(changeSubmissionStageAction, IDLE)
  const [selectedId, setSelectedId] = useState('')

  const errors = state.fieldErrors ?? {}
  const selected = stages.find((stage) => stage.id === selectedId)

  if (placed) {
    return (
      <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        This candidate has joined and a placement is recorded against the
        requirement. Reversing a placement changes booked revenue and is not
        something this screen can undo.
      </p>
    )
  }

  const choices = stages.filter(
    (stage) =>
      stage.id !== currentStageId && (!stage.isPlaced || openingsLeft > 0),
  )

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={submissionId} />

      <FormMessage state={state} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Move to"
          htmlFor="toStageId"
          hint={
            openingsLeft === 0
              ? 'Every opening on this requirement is filled, so the joined stage is not available.'
              : undefined
          }
          error={errors.toStageId}
          required
        >
          <Select
            id="toStageId"
            name="toStageId"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
            required
          >
            <option value="">Choose a stage</option>
            {choices.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Client feedback"
          htmlFor="clientFeedback"
          hint="What the client said about this profile."
          error={errors.clientFeedback}
        >
          <Input id="clientFeedback" name="clientFeedback" />
        </Field>

        {selected?.isRejected ? (
          <Field
            label="Why were they rejected?"
            htmlFor="rejectedReason"
            error={errors.rejectedReason}
            className="sm:col-span-2"
          >
            <Input
              id="rejectedReason"
              name="rejectedReason"
              placeholder="Notice period too long"
            />
          </Field>
        ) : null}

        {selected?.isPlaced ? (
          <>
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 sm:col-span-2">
              This records a placement against the requirement, moves it to its
              winning stage and brings the lead across as Won. It cannot be
              undone here.
            </p>

            <Field
              label="Joining date"
              htmlFor="joiningDate"
              error={errors.joiningDate}
              required
            >
              <Input id="joiningDate" name="joiningDate" type="date" required />
            </Field>

            <Field
              label={`Placement value (${currencySymbol})`}
              htmlFor="placementValue"
              hint="The fee or margin booked against this placement — what Won Revenue sums."
              error={errors.placementValue}
              required
            >
              <Input
                id="placementValue"
                name="placementValue"
                inputMode="decimal"
                required
              />
            </Field>

            <Field
              label={`Salary (${currencySymbol})`}
              htmlFor="salary"
              error={errors.salary}
            >
              <Input
                id="salary"
                name="salary"
                inputMode="decimal"
                defaultValue={offeredSalary ?? ''}
              />
            </Field>

            <Field
              label={`Bill rate (${currencySymbol})`}
              htmlFor="billRate"
              error={errors.billRate}
            >
              <Input
                id="billRate"
                name="billRate"
                inputMode="decimal"
                defaultValue={billRate ?? ''}
              />
            </Field>

            <Field
              label={`Margin per month (${currencySymbol})`}
              htmlFor="marginPerMonth"
              error={errors.marginPerMonth}
            >
              <Input
                id="marginPerMonth"
                name="marginPerMonth"
                inputMode="decimal"
              />
            </Field>

            <Field
              label="Guarantee period (days)"
              htmlFor="guaranteePeriodDays"
              hint="How long the replacement guarantee runs."
              error={errors.guaranteePeriodDays}
            >
              <Input
                id="guaranteePeriodDays"
                name="guaranteePeriodDays"
                inputMode="numeric"
                placeholder="90"
              />
            </Field>
          </>
        ) : null}

        <Field
          label="Note"
          htmlFor="note"
          hint="Kept in the stage history and on the requirement's timeline."
          error={errors.note}
          className="sm:col-span-2"
        >
          <Textarea id="note" name="note" className="min-h-16" />
        </Field>
      </div>

      <div className="flex gap-2">
        <SubmitButton size="sm">
          {selected?.isPlaced ? 'Record the placement' : 'Save stage'}
        </SubmitButton>
        {selected ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSelectedId('')}
          >
            Clear
          </Button>
        ) : null}
      </div>
    </form>
  )
}
