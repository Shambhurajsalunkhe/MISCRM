'use client'

import { useActionState, useEffect, useRef } from 'react'

import { Field, Input } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { IDLE } from '@/lib/form'
import { resetPasswordAction } from '../actions'

export function ResetPasswordForm({ id }: { id: string }) {
  const [state, formAction] = useActionState(resetPasswordAction, IDLE)
  const errors = state.fieldErrors ?? {}
  const formRef = useRef<HTMLFormElement>(null)

  // Clear both fields once the reset has gone through. Leaving a plaintext
  // password sitting in the DOM after it has been applied serves no purpose,
  // and on a shared admin screen it is the kind of thing that stays on display
  // until someone navigates away. Only on success — a failed attempt should
  // keep what was typed so it can be corrected.
  useEffect(() => {
    if (state.status === 'success') formRef.current?.reset()
  }, [state])

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={id} />

      <FormMessage state={state} />

      <Field
        label="New password"
        htmlFor="password"
        error={errors.password}
        hint="At least 10 characters."
        required
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          aria-invalid={Boolean(errors.password)}
          required
        />
      </Field>

      <Field
        label="Confirm password"
        htmlFor="confirmPassword"
        error={errors.confirmPassword}
        required
      >
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          aria-invalid={Boolean(errors.confirmPassword)}
          required
        />
      </Field>

      <SubmitButton variant="secondary">Reset password</SubmitButton>
    </form>
  )
}
