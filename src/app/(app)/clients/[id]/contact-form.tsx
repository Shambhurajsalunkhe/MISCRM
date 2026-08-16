'use client'

import { useActionState, useState } from 'react'

import { Button } from '@/components/ui/button'
import { CheckboxField, Field, Input } from '@/components/ui/field'
import { FormMessage, SubmitButton, WarningList } from '@/components/ui/form'
import { IDLE } from '@/lib/form'
import { saveContactAction } from '../actions'

export type ContactValues = {
  id: string
  name: string
  designation: string | null
  email: string | null
  phone: string | null
  linkedInProfile: string | null
  isPrimary: boolean
  isActive: boolean
}

/**
 * Add or edit one contact, inline on the client page.
 *
 * Collapsed to a button until opened. A client page is read far more often than
 * it is edited, and five expanded field sets above the leads table would push
 * the thing people came for below the fold.
 */
export function ContactForm({
  clientId,
  contact,
  label,
}: {
  clientId: string
  contact?: ContactValues
  label: string
}) {
  const [state, formAction] = useActionState(saveContactAction, IDLE)
  const [open, setOpen] = useState(false)
  const errors = state.fieldErrors ?? {}
  const needsOverride = (state.warnings?.length ?? 0) > 0

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
    )
  }

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3"
    >
      <input type="hidden" name="clientId" value={clientId} />
      {contact ? <input type="hidden" name="id" value={contact.id} /> : null}

      <FormMessage state={state} />
      <WarningList state={state} />

      {needsOverride ? (
        <Field
          label="Save anyway — why is this a separate contact?"
          htmlFor={`override-${contact?.id ?? 'new'}`}
          hint="Recorded in the audit trail."
          required
        >
          <Input
            id={`override-${contact?.id ?? 'new'}`}
            name="overrideReason"
            placeholder="e.g. moved to this company from the other one"
            required
          />
        </Field>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Name"
          htmlFor={`name-${contact?.id ?? 'new'}`}
          error={errors.name}
          required
        >
          <Input
            id={`name-${contact?.id ?? 'new'}`}
            name="name"
            defaultValue={contact?.name ?? ''}
            required
          />
        </Field>

        <Field
          label="Designation"
          htmlFor={`designation-${contact?.id ?? 'new'}`}
          error={errors.designation}
        >
          <Input
            id={`designation-${contact?.id ?? 'new'}`}
            name="designation"
            defaultValue={contact?.designation ?? ''}
          />
        </Field>

        <Field
          label="Email"
          htmlFor={`email-${contact?.id ?? 'new'}`}
          error={errors.email}
        >
          <Input
            id={`email-${contact?.id ?? 'new'}`}
            name="email"
            type="email"
            defaultValue={contact?.email ?? ''}
            aria-invalid={Boolean(errors.email)}
          />
        </Field>

        <Field
          label="Phone"
          htmlFor={`phone-${contact?.id ?? 'new'}`}
          error={errors.phone}
        >
          <Input
            id={`phone-${contact?.id ?? 'new'}`}
            name="phone"
            defaultValue={contact?.phone ?? ''}
          />
        </Field>

        <Field
          label="LinkedIn profile"
          htmlFor={`linkedin-${contact?.id ?? 'new'}`}
          error={errors.linkedInProfile}
          className="sm:col-span-2"
        >
          <Input
            id={`linkedin-${contact?.id ?? 'new'}`}
            name="linkedInProfile"
            defaultValue={contact?.linkedInProfile ?? ''}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <CheckboxField
          label="Primary contact"
          name="isPrimary"
          defaultChecked={contact?.isPrimary ?? false}
        />
        {contact ? (
          <CheckboxField
            label="Active"
            name="isActive"
            defaultChecked={contact.isActive}
          />
        ) : null}
      </div>

      <div className="flex gap-2">
        <SubmitButton size="sm">
          {needsOverride ? 'Save anyway' : contact ? 'Save' : 'Add contact'}
        </SubmitButton>
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
