'use client'

import { useActionState, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { IDLE } from '@/lib/form'
import { setRequirementStatusAction } from '../actions'
import type { RequirementStatus } from '@/generated/prisma/enums'

/**
 * Hold, resume or cancel — the three status changes that are not stage moves.
 *
 * Separate from the stage control because they are a different kind of
 * statement. A stage says how far the work has got; a hold says the client
 * paused and a cancellation says they withdrew, and neither moves the
 * requirement along its pipeline. Folding them into the stage dropdown would
 * put "Cancelled" between Interview and Selection on a list whose order is what
 * every conversion percentage is read from.
 */
export function RequirementStatusControl({
  requirementId,
  status,
}: {
  requirementId: string
  status: RequirementStatus
}) {
  const [state, formAction] = useActionState(setRequirementStatusAction, IDLE)
  const [open, setOpen] = useState(false)

  const onHold = status === 'ON_HOLD'
  const next = onHold ? 'OPEN' : 'ON_HOLD'

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {onHold ? 'Resume' : 'Hold or cancel'}
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

      <Field
        label="Note"
        htmlFor="status-reason"
        hint="Kept on the requirement's timeline."
      >
        <Input
          id="status-reason"
          name="reason"
          placeholder="Client paused hiring until the new quarter"
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <SubmitButton size="sm" name="status" value={next}>
          {onHold ? 'Resume work' : 'Put on hold'}
        </SubmitButton>

        {/* Cancelling is not lost: a withdrawn requirement has no lost reason
            to give, and `deriveLeadStatus` deliberately treats the two
            differently so withdrawals stay out of the lost-reason breakdown. */}
        <SubmitButton
          size="sm"
          variant="danger"
          name="status"
          value="CANCELLED"
          onClick={(event) => {
            if (
              !window.confirm(
                'Cancel this requirement? It stops counting as live work. Use Lost instead if it went to a competitor.',
              )
            ) {
              event.preventDefault()
            }
          }}
        >
          Cancel requirement
        </SubmitButton>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
        >
          Close
        </Button>
      </div>
    </form>
  )
}
