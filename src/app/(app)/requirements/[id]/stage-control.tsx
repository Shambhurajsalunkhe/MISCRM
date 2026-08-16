'use client'

import { useActionState, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { IDLE } from '@/lib/form'
import { changeRequirementStageAction } from '../actions'

export type RequirementStageChoice = {
  id: string
  name: string
  sortOrder: number
  isWon: boolean
  isLost: boolean
}

/**
 * The stage-advance control in the requirement header.
 *
 * The lead's equivalent with one stage removed rather than one added: **the
 * winning stage is never offered here**. A requirement reaches Placement
 * because somebody joined, and the route to that is marking the submission
 * Joined on the board, which records the placement and moves the requirement
 * with it. Offering it as a dropdown entry would invite a requirement counted
 * as filled with no placement behind it and no revenue against it — the server
 * refuses that anyway, so leaving it out here saves a failed round trip and,
 * more usefully, points at the control that does work.
 */
export function RequirementStageControl({
  requirementId,
  stages,
  currentStageId,
  currentSortOrder,
  lostReasons,
}: {
  requirementId: string
  stages: RequirementStageChoice[]
  currentStageId: string | null
  currentSortOrder: number | null
  lostReasons: Array<{ id: string; name: string }>
}) {
  const [state, formAction] = useActionState(changeRequirementStageAction, IDLE)
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState('')

  const errors = state.fieldErrors ?? {}
  const selected = stages.find((stage) => stage.id === selectedId)

  const movingBackwards =
    selected != null &&
    currentSortOrder != null &&
    selected.sortOrder < currentSortOrder

  const choices = stages.filter(
    (stage) => !stage.isWon && stage.id !== currentStageId,
  )

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
      <input type="hidden" name="id" value={requirementId} />

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
          {choices.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </Select>
      </Field>

      {selected?.isLost ? (
        <Field
          label="Why was it lost?"
          htmlFor="lostReasonId"
          hint="Drives the lost-reason breakdown on the Won/Lost report."
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
        {movingBackwards ? (
          <Input id="reason" name="reason" required />
        ) : (
          <Textarea id="reason" name="reason" className="min-h-16" />
        )}
      </Field>

      <p className="text-xs text-slate-500">
        Placement is not on this list. Mark the candidate as joined on the
        submission board — that records the placement and closes the requirement
        with it.
      </p>

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
