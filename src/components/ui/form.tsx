'use client'

import { useFormStatus } from 'react-dom'

import { Button } from '@/components/ui/button'
import type { ActionState } from '@/lib/form'
import { cn } from '@/lib/cn'

/**
 * Submit button that disables itself while its own form is pending.
 *
 * `useFormStatus` only reports the status of the nearest enclosing form, which
 * is what makes the per-row inline forms on the master-data screens behave
 * independently.
 */
export function SubmitButton({
  children,
  pendingLabel,
  ...props
}: React.ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus()

  return (
    <Button {...props} type="submit" disabled={pending || props.disabled}>
      {pending ? (pendingLabel ?? 'Saving…') : children}
    </Button>
  )
}

/**
 * Submit button guarded by a native confirm.
 *
 * Used for deactivation and reset-to-defaults. `onClick` runs before submit,
 * and preventing default there cancels it — no dialog library needed for a
 * yes/no on an action that is reversible anyway.
 */
export function ConfirmSubmitButton({
  confirmMessage,
  children,
  ...props
}: React.ComponentProps<typeof SubmitButton> & { confirmMessage: string }) {
  return (
    <SubmitButton
      {...props}
      onClick={(event) => {
        if (!window.confirm(confirmMessage)) event.preventDefault()
      }}
    >
      {children}
    </SubmitButton>
  )
}

/** The success/error banner for a form, rendered from its action state. */
export function FormMessage({
  state,
  className,
}: {
  state: ActionState
  className?: string
}) {
  if (state.status === 'idle' || !state.message) return null

  const isError = state.status === 'error'

  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        'rounded-md border px-3 py-2 text-sm',
        isError
          ? 'border-red-200 bg-red-50 text-red-700'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700',
        className,
      )}
    >
      {state.message}
    </p>
  )
}
