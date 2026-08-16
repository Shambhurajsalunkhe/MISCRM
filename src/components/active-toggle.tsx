'use client'

import { useActionState } from 'react'

import { ConfirmSubmitButton } from '@/components/ui/form'
import { IDLE, type ActionState } from '@/lib/form'

/**
 * Activate / deactivate for one row of a list.
 *
 * Every master-data table in the admin area uses `isActive` rather than a hard
 * delete, so this control is shared. The server action is passed in as a prop
 * — server actions are serialisable across the boundary, so one client
 * component covers every table without knowing which one it is in.
 *
 * Its own <form> per row keeps `useFormStatus` scoped to that row.
 */
export function ActiveToggle({
  action,
  id,
  isActive,
  confirmMessage,
  disabled,
  disabledReason,
  hidden,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  id: string
  isActive: boolean
  confirmMessage: string
  disabled?: boolean
  disabledReason?: string
  /** Extra form fields the action needs, such as the master-list slug. */
  hidden?: Record<string, string>
}) {
  const [state, formAction] = useActionState(action, IDLE)

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="isActive" value={isActive ? 'false' : 'true'} />
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      {state.status === 'error' && state.message ? (
        <span className="text-xs text-red-600">{state.message}</span>
      ) : null}

      <ConfirmSubmitButton
        variant="ghost"
        size="sm"
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        confirmMessage={confirmMessage}
        pendingLabel="…"
      >
        {isActive ? 'Deactivate' : 'Reactivate'}
      </ConfirmSubmitButton>
    </form>
  )
}
