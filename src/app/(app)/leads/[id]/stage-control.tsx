'use client'

import { useActionState, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { IDLE } from '@/lib/form'
import { changeStageAction } from '../actions'

export type StageChoice = {
  id: string
  name: string
  sortOrder: number
  isWon: boolean
  isLost: boolean
}

/**
 * The stage-advance control in the lead header.
 *
 * Three fields appear or disappear as the chosen stage changes, and each one is
 * a rule the server enforces independently — this only saves the user a failed
 * round trip:
 *
 *  - **Reason** when moving backwards. Open question Q2's accepted default:
 *    backward movement is allowed, with a reason recorded in stage history,
 *    because "ever reached" metrics (decision D12) read differently when a lead
 *    revisits a stage.
 *  - **Lost reason** when moving to a losing stage, since the Won/Lost report's
 *    breakdown is only as good as what gets picked here.
 *  - **Deal value** when winning, which is the moment the agreed number is
 *    actually known.
 */
export function StageControl({
  leadId,
  stages,
  currentStageId,
  currentSortOrder,
  lostReasons,
  currencySymbol,
  dealValue,
  canSetOutcome,
}: {
  leadId: string
  stages: StageChoice[]
  currentStageId: string | null
  currentSortOrder: number | null
  lostReasons: Array<{ id: string; name: string }>
  currencySymbol: string
  dealValue: string | null
  /** False for a role that may move a lead but not mark it Won or Lost. */
  canSetOutcome: boolean
}) {
  const [state, formAction] = useActionState(changeStageAction, IDLE)
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState('')

  const errors = state.fieldErrors ?? {}
  const selected = stages.find((stage) => stage.id === selectedId)

  const movingBackwards =
    selected != null &&
    currentSortOrder != null &&
    selected.sortOrder < currentSortOrder

  const choices = canSetOutcome
    ? stages
    : stages.filter((stage) => !stage.isWon && !stage.isLost)

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Change stage
      </Button>
    )
  }

  return (
    <form
      action={formAction}
      className="w-full space-y-3 rounded-md border border-slate-200 bg-white p-3"
    >
      <input type="hidden" name="id" value={leadId} />

      <FormMessage state={state} />

      <Field label="Move to" htmlFor="toStageId" error={errors.toStageId} required>
        <Select
          id="toStageId"
          name="toStageId"
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
          required
        >
          <option value="">Choose a stage</option>
          {choices
            .filter((stage) => stage.id !== currentStageId)
            .map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
        </Select>
      </Field>

      {selected?.isWon ? (
        <Field
          label={`Deal value (${currencySymbol})`}
          htmlFor="dealValue"
          hint="The agreed value. Leave blank to keep what is already recorded."
          error={errors.dealValue}
        >
          <Input
            id="dealValue"
            name="dealValue"
            inputMode="decimal"
            defaultValue={dealValue ?? ''}
          />
        </Field>
      ) : null}

      {selected?.isLost ? (
        <>
          <Field
            label="Why was it lost?"
            htmlFor="lostReasonId"
            error={errors.lostReasonId}
            required
          >
            <Select id="lostReasonId" name="lostReasonId" required>
              <option value="">Choose a reason</option>
              {lostReasons.map((reason) => (
                <option key={reason.id} value={reason.id}>
                  {reason.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Notes" htmlFor="lostNotes" error={errors.lostNotes}>
            <Textarea id="lostNotes" name="lostNotes" />
          </Field>
        </>
      ) : null}

      <Field
        label={movingBackwards ? 'Why is it moving back?' : 'Note'}
        htmlFor="reason"
        hint={
          movingBackwards
            ? 'Required, and kept in the stage history.'
            : 'Optional, shown on the timeline and in stage history.'
        }
        error={errors.reason}
        required={movingBackwards}
      >
        <Input id="reason" name="reason" required={movingBackwards} />
      </Field>

      <div className="flex gap-2">
        <SubmitButton size="sm">Save stage</SubmitButton>
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
