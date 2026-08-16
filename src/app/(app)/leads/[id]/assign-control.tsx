'use client'

import { useActionState, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { IDLE } from '@/lib/form'
import { assignLeadAction } from '../actions'

/**
 * Hand the lead to someone else (README §7, open question Q3).
 *
 * Only ever touches `assignedToId`. Who *generated* the lead is not offered
 * here and is not editable after creation — that column is what BDE Performance
 * counts, and a reassignment that rewrote it would erase the credit for
 * sourcing the deal.
 */
export function AssignControl({
  leadId,
  users,
  currentAssigneeId,
}: {
  leadId: string
  users: Array<{ id: string; name: string; roleLabel: string }>
  currentAssigneeId: string | null
}) {
  const [state, formAction] = useActionState(assignLeadAction, IDLE)
  const [open, setOpen] = useState(false)
  const errors = state.fieldErrors ?? {}

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {currentAssigneeId ? 'Reassign' : 'Assign'}
      </Button>
    )
  }

  return (
    <form
      action={formAction}
      className="w-full space-y-3 rounded-md border border-slate-200 bg-white p-3"
    >
      <input type="hidden" name="id" value={leadId} />

      <FormMessage state={state} />

      <Field label="Assign to" htmlFor="toUserId" error={errors.toUserId} required>
        <Select id="toUserId" name="toUserId" defaultValue="" required>
          <option value="">Choose a person</option>
          {users
            .filter((user) => user.id !== currentAssigneeId)
            .map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} · {user.roleLabel}
              </option>
            ))}
        </Select>
      </Field>

      <Field
        label="Reason"
        htmlFor="assign-reason"
        hint="Optional, kept in the assignment history."
      >
        <Input id="assign-reason" name="reason" />
      </Field>

      <div className="flex gap-2">
        <SubmitButton size="sm">Save</SubmitButton>
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
