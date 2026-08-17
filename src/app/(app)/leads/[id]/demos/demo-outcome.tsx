'use client'

import { useActionState, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import {
  DEMO_STATUS_LABELS,
  DEMO_STATUSES,
} from '@/lib/commercials/display'
import { IDLE } from '@/lib/form'
import type { DemoStatus } from '@/generated/prisma/enums'
import { updateDemoAction } from './actions'

/**
 * Record what happened in one demo, or move its date.
 *
 * Outcome and date sit in the same form because they are the same decision most
 * of the time: a demo the client did not attend is either a no-show or a
 * reschedule, and the reschedule needs the new date in the same submission or
 * the row spends a day saying it happened last Tuesday.
 */
export function DemoOutcome({
  demoId,
  status,
  scheduledAt,
  feedback,
}: {
  demoId: string
  status: DemoStatus
  /** `yyyy-MM-ddTHH:mm`, ready for `datetime-local`. */
  scheduledAt: string
  feedback: string | null
}) {
  const [state, formAction] = useActionState(updateDemoAction, IDLE)
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Update
      </Button>
    )
  }

  return (
    <form action={formAction} className="w-80 space-y-2 text-left">
      <input type="hidden" name="id" value={demoId} />

      <FormMessage state={state} />

      <Field label="Outcome" htmlFor={`status-${demoId}`}>
        <Select id={`status-${demoId}`} name="status" defaultValue={status}>
          {DEMO_STATUSES.map((value) => (
            <option key={value} value={value}>
              {DEMO_STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="When"
        htmlFor={`scheduledAt-${demoId}`}
        hint="Change this when the demo moves."
      >
        <Input
          id={`scheduledAt-${demoId}`}
          name="scheduledAt"
          type="datetime-local"
          defaultValue={scheduledAt}
        />
      </Field>

      <Field label="Feedback" htmlFor={`feedback-${demoId}`}>
        <Textarea
          id={`feedback-${demoId}`}
          name="feedback"
          rows={2}
          maxLength={4000}
          defaultValue={feedback ?? ''}
        />
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
