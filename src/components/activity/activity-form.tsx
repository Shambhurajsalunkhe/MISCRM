'use client'

import { useActionState, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import {
  ACTIVITY_TYPE_LABELS,
  MANUAL_ACTIVITY_TYPES,
} from '@/lib/activity-types'
import { IDLE } from '@/lib/form'
import { logActivityAction } from '@/server/activities'

/**
 * Log a call, email, meeting or note against a lead or a client (README §23).
 *
 * Collapsed until asked for, because the timeline is read far more often than
 * it is written to, and an open six-field form above the history pushes the
 * history off the screen.
 */
export function ActivityForm({
  leadId,
  clientId,
}: {
  leadId?: string
  clientId?: string
}) {
  const [state, formAction] = useActionState(logActivityAction, IDLE)
  const [open, setOpen] = useState(false)
  const errors = state.fieldErrors ?? {}

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Log activity
      </Button>
    )
  }

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3"
    >
      {leadId ? <input type="hidden" name="leadId" value={leadId} /> : null}
      {clientId ? <input type="hidden" name="clientId" value={clientId} /> : null}

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
            leadId
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
