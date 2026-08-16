'use client'

import { useActionState, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import {
  INTERVIEW_MODES,
  INTERVIEW_RESULT_LABELS,
  INTERVIEW_RESULTS,
} from '@/lib/staffing/display'
import { IDLE } from '@/lib/form'
import {
  recordInterviewResultAction,
  scheduleInterviewAction,
} from '../../../actions'
import type { InterviewResult } from '@/generated/prisma/enums'

/**
 * Schedule the next interview round (README §16).
 *
 * There is no round-number field. The round is issued by the server from the
 * rounds already recorded, because a second-round interview typed in as round 1
 * makes the Interviews count right and the sequence on screen wrong — the kind
 * of error nobody notices until they are reading a candidate's history aloud in
 * a debrief.
 */
export function ScheduleInterview({ submissionId }: { submissionId: string }) {
  const [state, formAction] = useActionState(scheduleInterviewAction, IDLE)
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
        Schedule round
      </Button>
    )
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3"
    >
      <input type="hidden" name="submissionId" value={submissionId} />

      <FormMessage state={state} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          label="When"
          htmlFor="scheduledAt"
          error={errors.scheduledAt}
          required
        >
          <Input
            id="scheduledAt"
            name="scheduledAt"
            type="datetime-local"
            required
          />
        </Field>

        <Field label="Mode" htmlFor="mode" error={errors.mode}>
          <Select id="mode" name="mode" defaultValue="">
            <option value="">Not specified</option>
            {INTERVIEW_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Interviewer"
          htmlFor="interviewerName"
          error={errors.interviewerName}
        >
          <Input
            id="interviewerName"
            name="interviewerName"
            placeholder="Client-side panel"
          />
        </Field>
      </div>

      <p className="text-xs text-slate-500">
        Scheduling a round does not move the candidate&rsquo;s stage — the board
        is where stages move, so a renamed or reordered stage list never changes
        what this button means.
      </p>

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

/**
 * Record what happened in a round.
 *
 * One form per row, so `useFormStatus` stays scoped to the round being saved
 * and a failure message lands beside the round it belongs to — the same shape
 * every inline row control in this app uses.
 */
export function InterviewResultForm({
  interviewId,
  result,
  feedback,
}: {
  interviewId: string
  result: InterviewResult
  feedback: string | null
}) {
  const [state, formAction] = useActionState(recordInterviewResultAction, IDLE)
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={interviewId} />

      <FormMessage state={state} />

      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Outcome" htmlFor={`result-${interviewId}`} error={errors.result}>
          <Select
            id={`result-${interviewId}`}
            name="result"
            defaultValue={result}
          >
            {INTERVIEW_RESULTS.map((option) => (
              <option key={option} value={option}>
                {INTERVIEW_RESULT_LABELS[option]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Feedback"
          htmlFor={`feedback-${interviewId}`}
          error={errors.feedback}
          className="sm:col-span-2"
        >
          <Textarea
            id={`feedback-${interviewId}`}
            name="feedback"
            defaultValue={feedback ?? ''}
            className="min-h-16"
          />
        </Field>
      </div>

      <SubmitButton size="sm" variant="secondary">
        Save round
      </SubmitButton>
    </form>
  )
}
