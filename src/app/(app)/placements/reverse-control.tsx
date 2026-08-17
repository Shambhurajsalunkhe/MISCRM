'use client'

import { useActionState, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Textarea } from '@/components/ui/field'
import { ConfirmSubmitButton, FormMessage } from '@/components/ui/form'
import { IDLE } from '@/lib/form'
import { reversePlacementAction } from './actions'

/**
 * Reverse a placement.
 *
 * The reason field is the control — a confirm dialog alone would let this
 * happen with nothing recorded but a timestamp, and the row it writes is the
 * only thing that will explain a drop in Won Revenue to whoever notices it next
 * month. So the form opens, asks, and only then offers the button.
 */
export function ReversePlacementControl({
  placementId,
  candidateName,
}: {
  placementId: string
  candidateName: string
}) {
  const [state, formAction] = useActionState(reversePlacementAction, IDLE)
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Reverse
      </Button>
    )
  }

  return (
    <form action={formAction} className="w-80 space-y-2 text-left">
      <input type="hidden" name="id" value={placementId} />

      <FormMessage state={state} />

      <Field
        label="Why is this being reversed?"
        htmlFor={`reason-${placementId}`}
        required
        hint="Withdrew, terminated inside the guarantee period, entered in error."
        error={state.fieldErrors?.reason}
      >
        <Textarea
          id={`reason-${placementId}`}
          name="reason"
          rows={2}
          maxLength={1000}
          required
        />
      </Field>

      <p className="text-xs text-slate-500">
        The placement stays on record and stops counting towards Won Revenue.
        The opening becomes available again. Refused while any invoice is still
        standing against it.
      </p>

      <div className="flex gap-2">
        <ConfirmSubmitButton
          variant="danger"
          size="sm"
          confirmMessage={`Reverse ${candidateName}'s placement? Booked revenue comes off the reports.`}
        >
          Reverse placement
        </ConfirmSubmitButton>
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
