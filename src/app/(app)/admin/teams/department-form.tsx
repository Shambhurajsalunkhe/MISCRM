'use client'

import { useActionState } from 'react'

import { ButtonLink } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { IDLE } from '@/lib/form'
import { saveDepartmentAction } from './actions'

/**
 * Inline add/rename row.
 *
 * Which row is in edit mode lives in the URL (`?edit=dept:<id>`) rather than in
 * client state, so the whole screen stays a server component, the back button
 * works, and a validation failure re-renders in place instead of losing which
 * row was open.
 */
export function DepartmentForm({
  department,
}: {
  department?: { id: string; name: string }
}) {
  const [state, formAction] = useActionState(saveDepartmentAction, IDLE)
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-2">
      {department ? (
        <input type="hidden" name="id" value={department.id} />
      ) : null}

      <FormMessage state={state} />

      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-48 flex-1">
          <label htmlFor="department-name" className="sr-only">
            Department name
          </label>
          <Input
            id="department-name"
            name="name"
            defaultValue={department?.name ?? ''}
            placeholder="Department name"
            aria-invalid={Boolean(errors.name)}
            autoFocus
            required
          />
          {errors.name ? (
            <p className="mt-1 text-xs text-red-600">{errors.name}</p>
          ) : null}
        </div>

        <SubmitButton size="md">{department ? 'Save' : 'Add'}</SubmitButton>
        <ButtonLink href="/admin/teams" variant="secondary">
          Cancel
        </ButtonLink>
      </div>
    </form>
  )
}
