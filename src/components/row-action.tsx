'use client'

import { useActionState } from 'react'

import { ConfirmSubmitButton } from '@/components/ui/form'
import { IDLE, type ActionState } from '@/lib/form'

/**
 * A confirmed one-field action on a single row — delete this document, delete
 * that activity.
 *
 * Same shape as `ActiveToggle`: the server action arrives as a prop, so one
 * client component covers every table without knowing which one it is in. Its
 * own <form> per row keeps `useFormStatus` scoped to that row, and keeps a
 * failure message beside the row it belongs to.
 */
export function RowAction({
  action,
  id,
  label,
  confirmMessage,
  hidden,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  id: string
  label: string
  confirmMessage: string
  /** Extra fields the action needs. */
  hidden?: Record<string, string>
}) {
  const [state, formAction] = useActionState(action, IDLE)

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      {state.status === 'error' && state.message ? (
        <span className="text-xs text-red-600">{state.message}</span>
      ) : null}

      <ConfirmSubmitButton
        variant="ghost"
        size="sm"
        confirmMessage={confirmMessage}
        pendingLabel="…"
      >
        {label}
      </ConfirmSubmitButton>
    </form>
  )
}
