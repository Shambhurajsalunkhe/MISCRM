'use client'

import { useActionState, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import {
  ACTIVITY_TYPE_LABELS,
  MANUAL_ACTIVITY_TYPES,
} from '@/lib/activity-types'
import {
  ATTACHMENT_FIELD,
  type AttachmentParent,
} from '@/lib/attachment-kinds'
import { IDLE } from '@/lib/form'
import { logActivityAction } from '@/server/activities'

/**
 * Log a call, email, meeting or note against a lead, client, requirement or
 * candidate (README §23).
 *
 * Collapsed until asked for, because the timeline is read far more often than
 * it is written to, and an open six-field form above the history pushes the
 * history off the screen.
 */
export function ActivityForm({ parent }: { parent: AttachmentParent }) {
  const [state, formAction] = useActionState(logActivityAction, IDLE)
  const [open, setOpen] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const errors = state.fieldErrors ?? {}

  // Close and clear once the activity is logged. Left open, the form kept the
  // previous entry's text, so the obvious next action — log another call —
  // started from a filled-in form that looked like it had already been
  // submitted, and pressing the button again posted a duplicate.
  useEffect(() => {
    if (state.status === 'success') {
      formRef.current?.reset()
      setOpen(false)
    }
  }, [state])

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Log activity
      </Button>
    )
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3"
    >
      <input
        type="hidden"
        name={ATTACHMENT_FIELD[parent.kind]}
        value={parent.id}
      />

      <FormMessage state={state} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type" htmlFor="activity-type" error={errors.type} required>
          <Select id="activity-type" name="type" defaultValue="CALL" required>
            {MANUAL_ACTIVITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {ACTIVITY_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="When"
          htmlFor="activity-date"
          hint="Leave blank for now."
          error={errors.activityDate}
        >
          <Input id="activity-date" name="activityDate" type="datetime-local" />
        </Field>

        <Field
          label="Subject"
          htmlFor="activity-subject"
          error={errors.subject}
          required
          className="sm:col-span-2"
        >
          <Input
            id="activity-subject"
            name="subject"
            placeholder="Intro call with the CTO"
            aria-invalid={Boolean(errors.subject)}
            required
          />
        </Field>

        <Field
          label="Notes"
          htmlFor="activity-notes"
          error={errors.notes}
          className="sm:col-span-2"
        >
          <Textarea id="activity-notes" name="notes" />
        </Field>

        <Field label="Outcome" htmlFor="activity-outcome" error={errors.outcome}>
          <Input
            id="activity-outcome"
            name="outcome"
            placeholder="Wants a proposal by Friday"
          />
        </Field>

        <Field
          label="Follow up on"
          htmlFor="activity-followup"
          hint={
            parent.kind === 'lead'
              ? 'Also sets the lead’s next follow-up date, unless one sooner is already set.'
              : undefined
          }
          error={errors.followUpDate}
        >
          <Input id="activity-followup" name="followUpDate" type="date" />
        </Field>
      </div>

      <div className="flex gap-2">
        <SubmitButton size="sm">Log activity</SubmitButton>
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
