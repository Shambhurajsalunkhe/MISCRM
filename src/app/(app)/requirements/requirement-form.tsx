'use client'

import { useActionState } from 'react'

import { ButtonLink } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { Card } from '@/components/ui/page'
import { PRIORITY_LABELS, PRIORITY_ORDER } from '@/lib/leads/display'
import { WORK_MODES } from '@/lib/staffing/display'
import { IDLE } from '@/lib/form'
import { createRequirementAction, updateRequirementAction } from './actions'

export type RequirementLeadOption = {
  id: string
  leadCode: string
  title: string
  companyName: string
}

export type RequirementFormValues = {
  position: string
  requirementTypeId: string
  openings: string
  skills: string
  minExperience: string
  maxExperience: string
  location: string
  workMode: string
  budgetMin: string
  budgetMax: string
  targetDate: string
  priority: string
  description: string
  assignedToId: string
}

/**
 * One form for raising a requirement and for editing it (README §14).
 *
 * The two differ in exactly two ways, both of which are about the parent:
 *
 *  - **New takes a lead; edit does not.** A requirement's lead decides its
 *    client, and moving it would leave its placements booked against one
 *    account and its submissions discussed on another. The lead is fixed at
 *    creation for the same reason a lead's vertical is.
 *  - **Arriving from a lead's own Requirements tab skips the picker entirely**,
 *    which is the normal route in and the reason the picker's 500-row cap is
 *    tolerable.
 */
export function RequirementForm({
  mode,
  requirementId,
  leads,
  lockedLead,
  types,
  people,
  currencySymbol,
  values,
  cancelHref,
  leadPickerTruncated,
}: {
  mode: 'create' | 'edit'
  requirementId?: string
  /** Empty when the lead is fixed. */
  leads?: RequirementLeadOption[]
  /** Set when the form was opened from a lead, so there is nothing to choose. */
  lockedLead?: RequirementLeadOption
  types: Array<{ id: string; name: string }>
  people: Array<{ id: string; name: string }>
  currencySymbol: string
  values?: Partial<RequirementFormValues>
  cancelHref: string
  leadPickerTruncated?: boolean
}) {
  const [state, formAction] = useActionState(
    mode === 'create' ? createRequirementAction : updateRequirementAction,
    IDLE,
  )

  const errors = state.fieldErrors ?? {}
  const value = (key: keyof RequirementFormValues) => values?.[key] ?? ''

  return (
    <form action={formAction} className="space-y-4">
      {mode === 'edit' && requirementId ? (
        <input type="hidden" name="id" value={requirementId} />
      ) : null}
      {lockedLead ? (
        <input type="hidden" name="leadId" value={lockedLead.id} />
      ) : null}

      <FormMessage state={state} />

      <Card title="The role">
        <div className="grid gap-3 sm:grid-cols-2">
          {mode === 'create' && !lockedLead ? (
            <Field
              label="Lead"
              htmlFor="leadId"
              hint={
                leadPickerTruncated
                  ? 'The 500 most recent staffing leads. For an older one, open the lead and use its Requirements tab.'
                  : 'Only leads in a vertical whose requirements module is on.'
              }
              error={errors.leadId}
              required
              className="sm:col-span-2"
            >
              <Select id="leadId" name="leadId" defaultValue="" required>
                <option value="">Choose a lead</option>
                {(leads ?? []).map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {lead.leadCode} — {lead.companyName} — {lead.title}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {lockedLead ? (
            <p className="text-sm text-slate-500 sm:col-span-2">
              Under{' '}
              <a
                href={`/leads/${lockedLead.id}`}
                className="font-medium text-slate-700 hover:underline"
              >
                {lockedLead.leadCode}
              </a>{' '}
              for {lockedLead.companyName}.
            </p>
          ) : null}

          <Field
            label="Position"
            htmlFor="position"
            error={errors.position}
            required
            className="sm:col-span-2"
          >
            <Input
              id="position"
              name="position"
              defaultValue={value('position')}
              placeholder="Senior Java Developer"
              aria-invalid={Boolean(errors.position)}
              required
            />
          </Field>

          <Field label="Type" htmlFor="requirementTypeId" error={errors.requirementTypeId}>
            <Select
              id="requirementTypeId"
              name="requirementTypeId"
              defaultValue={value('requirementTypeId')}
            >
              <option value="">Not specified</option>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Openings"
            htmlFor="openings"
            hint="How many people the client needs. Each one filled is a placement."
            error={errors.openings}
            required
          >
            <Input
              id="openings"
              name="openings"
              type="number"
              min={1}
              defaultValue={value('openings') || '1'}
              aria-invalid={Boolean(errors.openings)}
              required
            />
          </Field>

          <Field
            label="Skills"
            htmlFor="skills"
            hint="Comma separated. Searched by the candidate skill filter."
            error={errors.skills}
            className="sm:col-span-2"
          >
            <Input
              id="skills"
              name="skills"
              defaultValue={value('skills')}
              placeholder="Java, Spring Boot, Kafka"
            />
          </Field>

          <Field
            label="Minimum experience (years)"
            htmlFor="minExperience"
            error={errors.minExperience}
          >
            <Input
              id="minExperience"
              name="minExperience"
              inputMode="decimal"
              defaultValue={value('minExperience')}
              placeholder="4"
            />
          </Field>

          <Field
            label="Maximum experience (years)"
            htmlFor="maxExperience"
            error={errors.maxExperience}
          >
            <Input
              id="maxExperience"
              name="maxExperience"
              inputMode="decimal"
              defaultValue={value('maxExperience')}
              placeholder="8"
            />
          </Field>

          <Field label="Location" htmlFor="location" error={errors.location}>
            <Input
              id="location"
              name="location"
              defaultValue={value('location')}
              placeholder="Pune"
            />
          </Field>

          <Field label="Work mode" htmlFor="workMode" error={errors.workMode}>
            <Select id="workMode" name="workMode" defaultValue={value('workMode')}>
              <option value="">Not specified</option>
              {WORK_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card title="Commercials and timing">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={`Budget from (${currencySymbol})`}
            htmlFor="budgetMin"
            error={errors.budgetMin}
          >
            <Input
              id="budgetMin"
              name="budgetMin"
              inputMode="decimal"
              defaultValue={value('budgetMin')}
            />
          </Field>

          <Field
            label={`Budget to (${currencySymbol})`}
            htmlFor="budgetMax"
            error={errors.budgetMax}
          >
            <Input
              id="budgetMax"
              name="budgetMax"
              inputMode="decimal"
              defaultValue={value('budgetMax')}
            />
          </Field>

          <Field
            label="Target date"
            htmlFor="targetDate"
            hint="When the client wants the role closed."
            error={errors.targetDate}
          >
            <Input
              id="targetDate"
              name="targetDate"
              type="date"
              defaultValue={value('targetDate')}
            />
          </Field>

          <Field label="Priority" htmlFor="priority" error={errors.priority}>
            <Select
              id="priority"
              name="priority"
              defaultValue={value('priority') || 'MEDIUM'}
            >
              {PRIORITY_ORDER.map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_LABELS[priority]}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Owner"
            htmlFor="assignedToId"
            hint={
              mode === 'create'
                ? 'Leave blank to give it to whoever is working the lead.'
                : undefined
            }
            error={errors.assignedToId}
          >
            <Select
              id="assignedToId"
              name="assignedToId"
              defaultValue={value('assignedToId')}
            >
              <option value="">Unassigned</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Description"
            htmlFor="description"
            error={errors.description}
            className="sm:col-span-2"
          >
            <Textarea
              id="description"
              name="description"
              defaultValue={value('description')}
              placeholder="What the client said, in their words."
            />
          </Field>
        </div>
      </Card>

      <div className="flex gap-2">
        <SubmitButton>
          {mode === 'create' ? 'Create requirement' : 'Save changes'}
        </SubmitButton>
        <ButtonLink href={cancelHref} variant="ghost">
          Cancel
        </ButtonLink>
      </div>
    </form>
  )
}
