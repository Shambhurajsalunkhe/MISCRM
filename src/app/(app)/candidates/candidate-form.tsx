'use client'

import { useActionState } from 'react'

import { ButtonLink } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormMessage, SubmitButton, WarningList } from '@/components/ui/form'
import { Card } from '@/components/ui/page'
import { CANDIDATE_SOURCE_CHANNELS } from '@/lib/staffing/display'
import { IDLE } from '@/lib/form'
import { createCandidateAction, updateCandidateAction } from './actions'

export type CandidateFormValues = {
  fullName: string
  email: string
  phone: string
  currentLocation: string
  preferredLocation: string
  totalExperienceYears: string
  primarySkills: string
  currentEmployer: string
  currentCtc: string
  expectedCtc: string
  noticePeriodDays: string
  linkedInProfile: string
  sourceChannel: string
  notes: string
}

/**
 * Add or edit a candidate.
 *
 * The duplicate warning is the part worth reading. A matching email or phone
 * refuses the save *once* and shows what it found, and the same submission goes
 * through with a reason attached — which is written to the audit trail, exactly
 * as the client form does it (docs/01-data-model.md §1). There is no hard
 * constraint behind it, deliberately: two people genuinely do share a name, and
 * a master that cannot record the second one is worse than one that occasionally
 * holds a duplicate.
 */
export function CandidateForm({
  mode,
  candidateId,
  values,
  cancelHref,
  currencySymbol,
}: {
  mode: 'create' | 'edit'
  candidateId?: string
  values?: Partial<CandidateFormValues>
  cancelHref: string
  currencySymbol: string
}) {
  const [state, formAction] = useActionState(
    mode === 'create' ? createCandidateAction : updateCandidateAction,
    IDLE,
  )

  const errors = state.fieldErrors ?? {}
  const value = (key: keyof CandidateFormValues) => values?.[key] ?? ''
  const warned = (state.warnings?.length ?? 0) > 0

  return (
    <form action={formAction} className="space-y-4">
      {mode === 'edit' && candidateId ? (
        <input type="hidden" name="id" value={candidateId} />
      ) : null}

      <FormMessage state={state} />
      <WarningList state={state} />

      {warned ? (
        <Field
          label="Why is this a separate person?"
          htmlFor="overrideReason"
          hint="Kept in the audit trail against this profile."
          required
        >
          <Input
            id="overrideReason"
            name="overrideReason"
            placeholder="Different person, shares a family phone number"
            required
          />
        </Field>
      ) : null}

      <Card title="Who they are">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Full name"
            htmlFor="fullName"
            error={errors.fullName}
            required
            className="sm:col-span-2"
          >
            <Input
              id="fullName"
              name="fullName"
              defaultValue={value('fullName')}
              aria-invalid={Boolean(errors.fullName)}
              required
            />
          </Field>

          <Field label="Email" htmlFor="email" error={errors.email}>
            <Input
              id="email"
              name="email"
              type="email"
              defaultValue={value('email')}
            />
          </Field>

          <Field
            label="Phone"
            htmlFor="phone"
            hint="Any format. Matching is on the digits."
            error={errors.phone}
          >
            <Input id="phone" name="phone" defaultValue={value('phone')} />
          </Field>

          <Field
            label="Current location"
            htmlFor="currentLocation"
            error={errors.currentLocation}
          >
            <Input
              id="currentLocation"
              name="currentLocation"
              defaultValue={value('currentLocation')}
            />
          </Field>

          <Field
            label="Preferred location"
            htmlFor="preferredLocation"
            error={errors.preferredLocation}
          >
            <Input
              id="preferredLocation"
              name="preferredLocation"
              defaultValue={value('preferredLocation')}
            />
          </Field>

          <Field
            label="LinkedIn"
            htmlFor="linkedInProfile"
            error={errors.linkedInProfile}
            className="sm:col-span-2"
          >
            <Input
              id="linkedInProfile"
              name="linkedInProfile"
              defaultValue={value('linkedInProfile')}
              placeholder="https://www.linkedin.com/in/…"
            />
          </Field>
        </div>
      </Card>

      <Card title="Experience and availability">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Total experience (years)"
            htmlFor="totalExperienceYears"
            error={errors.totalExperienceYears}
          >
            <Input
              id="totalExperienceYears"
              name="totalExperienceYears"
              inputMode="decimal"
              defaultValue={value('totalExperienceYears')}
              placeholder="6.5"
            />
          </Field>

          <Field
            label="Current employer"
            htmlFor="currentEmployer"
            error={errors.currentEmployer}
          >
            <Input
              id="currentEmployer"
              name="currentEmployer"
              defaultValue={value('currentEmployer')}
            />
          </Field>

          <Field
            label="Primary skills"
            htmlFor="primarySkills"
            hint="Comma separated. The skill filter matches every term you type against this."
            error={errors.primarySkills}
            className="sm:col-span-2"
          >
            <Input
              id="primarySkills"
              name="primarySkills"
              defaultValue={value('primarySkills')}
              placeholder="Java, Spring Boot, Kafka, AWS"
            />
          </Field>

          <Field
            label={`Current CTC (${currencySymbol})`}
            htmlFor="currentCtc"
            error={errors.currentCtc}
          >
            <Input
              id="currentCtc"
              name="currentCtc"
              inputMode="decimal"
              defaultValue={value('currentCtc')}
            />
          </Field>

          <Field
            label={`Expected CTC (${currencySymbol})`}
            htmlFor="expectedCtc"
            error={errors.expectedCtc}
          >
            <Input
              id="expectedCtc"
              name="expectedCtc"
              inputMode="decimal"
              defaultValue={value('expectedCtc')}
            />
          </Field>

          <Field
            label="Notice period (days)"
            htmlFor="noticePeriodDays"
            error={errors.noticePeriodDays}
          >
            <Input
              id="noticePeriodDays"
              name="noticePeriodDays"
              inputMode="numeric"
              defaultValue={value('noticePeriodDays')}
              placeholder="60"
            />
          </Field>

          <Field
            label="Sourced from"
            htmlFor="sourceChannel"
            error={errors.sourceChannel}
          >
            <Select
              id="sourceChannel"
              name="sourceChannel"
              defaultValue={value('sourceChannel')}
            >
              <option value="">Not specified</option>
              {CANDIDATE_SOURCE_CHANNELS.map((channel) => (
                <option key={channel} value={channel}>
                  {channel}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Notes"
            htmlFor="notes"
            error={errors.notes}
            className="sm:col-span-2"
          >
            <Textarea
              id="notes"
              name="notes"
              defaultValue={value('notes')}
              placeholder="What came out of the screening call."
            />
          </Field>
        </div>
      </Card>

      <div className="flex gap-2">
        <SubmitButton>
          {mode === 'create' ? 'Add candidate' : 'Save changes'}
        </SubmitButton>
        <ButtonLink href={cancelHref} variant="ghost">
          Cancel
        </ButtonLink>
      </div>
    </form>
  )
}
