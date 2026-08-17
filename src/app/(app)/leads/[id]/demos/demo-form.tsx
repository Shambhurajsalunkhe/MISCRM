'use client'

import { useActionState, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { IDLE } from '@/lib/form'
import { scheduleDemoAction } from './actions'

export type PickerOption = { id: string; name: string }

/**
 * Book a demo against a Product Sales lead.
 *
 * Collapsed until asked for, like the document uploader: the tab's job is to
 * show the demos that exist, and a permanently open form pushes them below the
 * fold on the leads that have the most of them.
 */
export function DemoForm({
  leadId,
  products,
  users,
  defaultConductedById,
}: {
  leadId: string
  products: PickerOption[]
  users: PickerOption[]
  defaultConductedById: string
}) {
  const [state, formAction] = useActionState(scheduleDemoAction, IDLE)
  const [open, setOpen] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const errors = state.fieldErrors ?? {}

  useEffect(() => {
    if (state.status === 'success') {
      formRef.current?.reset()
      setOpen(false)
    }
  }, [state])

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Schedule demo
      </Button>
    )
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3"
    >
      <input type="hidden" name="leadId" value={leadId} />

      <FormMessage state={state} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="When"
          htmlFor="scheduledAt"
          required
          error={errors.scheduledAt}
        >
          <Input
            id="scheduledAt"
            name="scheduledAt"
            type="datetime-local"
            required
          />
        </Field>

        <Field label="Product" htmlFor="productId" error={errors.productId}>
          <Select id="productId" name="productId" defaultValue="">
            <option value="">Not specified</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Conducted by"
          htmlFor="conductedById"
          error={errors.conductedById}
        >
          <Select
            id="conductedById"
            name="conductedById"
            defaultValue={defaultConductedById}
          >
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Attendees"
          htmlFor="attendees"
          hint="Who is joining from the client side."
          error={errors.attendees}
        >
          <Input id="attendees" name="attendees" maxLength={500} />
        </Field>
      </div>

      <Field label="Notes" htmlFor="notes" error={errors.notes}>
        <Textarea id="notes" name="notes" rows={2} maxLength={4000} />
      </Field>

      <div className="flex gap-2">
        <SubmitButton size="sm">Schedule</SubmitButton>
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
