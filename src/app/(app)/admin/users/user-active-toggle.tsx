'use client'

import { useActionState } from 'react'

import { ConfirmSubmitButton } from '@/components/ui/form'
import { IDLE } from '@/lib/form'
import { setUserActiveAction } from './actions'

/**
 * The per-row activate / deactivate control.
 *
 * Each row is its own form so `useFormStatus` inside the button reports only
 * that row's pending state — one shared form would grey out the whole table.
 */
export function UserActiveToggle({
  id,
  name,
  isActive,
  isSelf,
}: {
  id: string
  name: string
  isActive: boolean
  isSelf: boolean
}) {
  const [state, formAction] = useActionState(setUserActiveAction, IDLE)

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="isActive" value={isActive ? 'false' : 'true'} />

      {state.status === 'error' && state.message ? (
        <span className="text-xs text-red-600">{state.message}</span>
      ) : null}

      <ConfirmSubmitButton
        variant="ghost"
        size="sm"
        // The server rejects this too; disabling here just avoids offering an
        // action that is always going to fail.
        disabled={isSelf && isActive}
        title={
          isSelf && isActive ? 'You cannot deactivate your own account.' : undefined
        }
        confirmMessage={
          isActive
            ? `Deactivate ${name}? They will be signed out and cannot sign in again until reactivated. Their leads and history are kept.`
            : `Reactivate ${name}? They will be able to sign in again.`
        }
        pendingLabel="…"
      >
        {isActive ? 'Deactivate' : 'Reactivate'}
      </ConfirmSubmitButton>
    </form>
  )
}
