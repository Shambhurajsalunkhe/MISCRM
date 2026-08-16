'use client'

import { useActionState } from 'react'

import { SubmitButton } from '@/components/ui/form'
import { IDLE } from '@/lib/form'
import { movePipelineStageAction } from './actions'

/** Reorder one stage by swapping it with its neighbour. */
export function MoveStage({
  id,
  direction,
  disabled,
}: {
  id: string
  direction: 'up' | 'down'
  disabled: boolean
}) {
  const [state, formAction] = useActionState(movePipelineStageAction, IDLE)

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="direction" value={direction} />

      {/* Reordering fails silently otherwise: the row simply does not move and
          nothing says why. The live region announces it for screen readers,
          which have no other cue that a reorder was attempted at all. */}
      {state.status === 'error' && state.message ? (
        <span role="alert" className="mr-1 text-xs text-red-600">
          {state.message}
        </span>
      ) : (
        <span role="status" className="sr-only">
          {state.status === 'success' ? state.message : ''}
        </span>
      )}
      <SubmitButton
        variant="ghost"
        size="sm"
        disabled={disabled}
        pendingLabel="…"
        aria-label={`Move stage ${direction}`}
        className="px-1.5"
      >
        {direction === 'up' ? '↑' : '↓'}
      </SubmitButton>
    </form>
  )
}
