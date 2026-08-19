'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { Card, EmptyState } from '@/components/ui/page'
import {
  ACTIVITY_TYPE_LABELS,
  MANUAL_ACTIVITY_TYPES,
} from '@/lib/activity-types'
import type { ActivityType } from '@/generated/prisma/enums'
import { IDLE } from '@/lib/form'
import {
  completeActivityAction,
  rescheduleActivityAction,
  scheduleActivityAction,
} from '@/server/activities'

export type UpcomingCallView = {
  id: string
  type: string
  subject: string
  notes: string | null
  /** `yyyy-MM-ddTHH:mm`, ready for the reschedule input. */
  at: string
  dayLabel: string
  timeLabel: string
  overdue: boolean
  lead: { id: string; leadCode: string; title: string; clientName: string }
}

export type SchedulableLead = { id: string; label: string }

/**
 * The diary that sits under the lead list.
 *
 * It exists because arranging a call used to mean opening the lead first, which
 * made "what am I doing tomorrow" a question you could only answer one lead at a
 * time. Overdue entries stay in the list and sort to the top, since a call that
 * was due yesterday is the one needing attention rather than the one to hide.
 *
 * Dates arrive pre-formatted from the server. Formatting a `Date` here would do
 * it in the browser's timezone, and a list of times that shifts between the
 * server render and the hydrated one is the classic timezone flicker.
 */
export function UpcomingCalls({
  calls,
  leads,
  truncated,
  pickerTruncated,
  limit,
}: {
  calls: UpcomingCallView[]
  leads: SchedulableLead[]
  truncated: boolean
  pickerTruncated: boolean
  limit: number
}) {
  const [adding, setAdding] = useState(false)

  return (
    <Card
      title="Timeline"
      description="Calls and meetings you have arranged, soonest first. Anything past its time stays here until you mark it done."
      actions={
        leads.length > 0 ? (
          <Button
            variant={adding ? 'ghost' : 'secondary'}
            size="sm"
            onClick={() => setAdding((open) => !open)}
          >
            {adding ? 'Cancel' : 'Schedule a call'}
          </Button>
        ) : null
      }
    >
      {adding ? (
        <ScheduleForm
          leads={leads}
          truncated={pickerTruncated}
          onDone={() => setAdding(false)}
        />
      ) : null}

      {calls.length === 0 ? (
        <EmptyState>
          Nothing scheduled. Use Schedule a call to put one in, or open a lead
          and arrange it from its timeline.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {calls.map((call) => (
            <CallRow key={call.id} call={call} />
          ))}
        </ul>
      )}

      {truncated ? (
        <p className="mt-3 text-xs text-slate-500">
          Showing the next {limit}. Mark the ones you have done to see further
          ahead.
        </p>
      ) : null}
    </Card>
  )
}

function CallRow({ call }: { call: UpcomingCallView }) {
  const [editing, setEditing] = useState(false)

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className={
            call.overdue
              ? 'text-sm font-semibold text-rose-700'
              : 'text-sm font-semibold text-slate-900'
          }
        >
          {call.dayLabel}, {call.timeLabel}
        </span>

        {call.overdue ? (
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">
            Overdue
          </span>
        ) : null}

        <span className="text-xs text-slate-500">
          {ACTIVITY_TYPE_LABELS[call.type as ActivityType] ?? call.type}
        </span>
      </div>

      <p className="mt-0.5 text-sm text-slate-900">{call.subject}</p>

      <p className="text-xs text-slate-500">
        <Link
          href={`/leads/${call.lead.id}`}
          className="font-medium text-slate-700 underline-offset-2 hover:underline"
        >
          {call.lead.leadCode}
        </Link>{' '}
        · {call.lead.clientName} · {call.lead.title}
      </p>

      {call.notes ? (
        <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">
          {call.notes}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
          {editing ? 'Keep it' : 'Adjust'}
        </Button>
        <CompleteButton id={call.id} />
      </div>

      {editing ? <RescheduleForm id={call.id} current={call.at} /> : null}
    </li>
  )
}

function CompleteButton({ id }: { id: string }) {
  const [state, formAction] = useActionState(completeActivityAction, IDLE)

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <SubmitButton size="sm" variant="secondary">
        Mark done
      </SubmitButton>
      {state.status === 'error' ? (
        <span className="text-xs text-rose-700">{state.message}</span>
      ) : null}
    </form>
  )
}

/**
 * Adjust the time of one arranged call.
 *
 * The row stays open after a successful save rather than closing itself. The
 * server action revalidates `/leads`, so the row re-renders with its new time
 * and the message beside the button is the confirmation — closing the form from
 * inside a render pass is what `useActionState` will not let you do cleanly.
 */
function RescheduleForm({ id, current }: { id: string; current: string }) {
  const [state, formAction] = useActionState(rescheduleActivityAction, IDLE)

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <Field label="New date and time" htmlFor={`at-${id}`}>
        <Input
          id={`at-${id}`}
          name="activityDate"
          type="datetime-local"
          defaultValue={current}
          required
        />
      </Field>
      <SubmitButton size="sm">Save</SubmitButton>
      {state.status !== 'idle' ? (
        <span
          className={
            state.status === 'error'
              ? 'pb-2 text-xs text-rose-700'
              : 'pb-2 text-xs text-emerald-700'
          }
        >
          {state.message}
        </span>
      ) : null}
    </form>
  )
}

function ScheduleForm({
  leads,
  truncated,
  onDone,
}: {
  leads: SchedulableLead[]
  truncated: boolean
  onDone: () => void
}) {
  const [state, formAction] = useActionState(scheduleActivityAction, IDLE)
  const formRef = useRef<HTMLFormElement>(null)
  const errors = state.fieldErrors ?? {}

  // Clear and close once it is scheduled. Left open, the form keeps the lead,
  // time and subject just submitted, so the obvious next action -- arrange
  // another call -- starts from a filled-in form that looks like it has already
  // been sent, and pressing the button again schedules the same call twice.
  // The same trap `activity-form.tsx` documents having fallen into once.
  useEffect(() => {
    if (state.status === 'success') {
      formRef.current?.reset()
      onDone()
    }
  }, [state, onDone])

  return (
    <form
      ref={formRef}
      action={formAction}
      className="mb-4 space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3"
    >
      <FormMessage state={state} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Lead"
          htmlFor="plan-lead"
          error={errors.leadId}
          hint={
            truncated
              ? 'The deal this call is about. Showing the most recent open leads. If yours is missing, open it and arrange the call from its timeline.'
              : 'The deal this call is about.'
          }
          required
          className="sm:col-span-2"
        >
          <Select id="plan-lead" name="leadId" defaultValue="" required>
            <option value="">Choose a lead</option>
            {leads.map((lead) => (
              <option key={lead.id} value={lead.id}>
                {lead.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Type" htmlFor="plan-type" error={errors.type} required>
          <Select id="plan-type" name="type" defaultValue="CALL">
            {MANUAL_ACTIVITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {ACTIVITY_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Date and time"
          htmlFor="plan-at"
          error={errors.activityDate}
          required
        >
          <Input
            id="plan-at"
            name="activityDate"
            type="datetime-local"
            required
          />
        </Field>

        <Field
          label="What it is about"
          htmlFor="plan-subject"
          error={errors.subject}
          required
          className="sm:col-span-2"
        >
          <Input
            id="plan-subject"
            name="subject"
            placeholder="Pricing call with the CTO"
            required
          />
        </Field>

        <Field
          label="Notes"
          htmlFor="plan-notes"
          error={errors.notes}
          className="sm:col-span-2"
        >
          <Textarea id="plan-notes" name="notes" />
        </Field>
      </div>

      <div className="flex gap-2">
        <SubmitButton size="sm">Schedule</SubmitButton>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Close
        </Button>
      </div>
    </form>
  )
}
