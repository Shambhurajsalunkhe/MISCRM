'use client'

import { useActionState } from 'react'

import { ButtonLink } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { Card } from '@/components/ui/page'
import { PRIORITY_LABELS, PRIORITY_ORDER } from '@/lib/leads/display'
import type { LeadFormLayout } from '@/lib/leads/vertical-form'
import { toDateInputValue } from '@/lib/format'
import { IDLE } from '@/lib/form'
import { updateLeadAction } from '../../actions'

export type LeadEditValues = {
  id: string
  title: string
  requirementDescription: string | null
  sourceId: string | null
  productId: string | null
  primaryContactId: string | null
  expectedBudget: string | null
  dealValue: string | null
  expectedTimeline: string | null
  priority: (typeof PRIORITY_ORDER)[number]
  additionalNotes: string | null
  campaignName: string | null
  referenceUrl: string | null
  expectedCloseDate: Date | null
  nextFollowUpAt: Date | null
}

/**
 * Edit the requirement side of a lead.
 *
 * Stage, assignment and vertical are deliberately absent. The first two have
 * their own controls in the header because each writes a history row, and the
 * third is fixed at creation — changing it would leave the lead's stage history
 * pointing at stages its new vertical does not contain.
 */
export function LeadEditForm({
  lead,
  layout,
  options,
  currencySymbol,
  canSetDealValue,
}: {
  lead: LeadEditValues
  layout: LeadFormLayout
  options: {
    contacts: Array<{ id: string; label: string }>
    sources: Array<{ id: string; name: string }>
    products: Array<{ id: string; name: string }>
  }
  currencySymbol: string
  canSetDealValue: boolean
}) {
  const [state, formAction] = useActionState(updateLeadAction, IDLE)
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={lead.id} />

      <FormMessage state={state} />

      <Card title="Requirement">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Requirement"
            htmlFor="title"
            error={errors.title}
            required
            className="sm:col-span-2"
          >
            <Input
              id="title"
              name="title"
              defaultValue={lead.title}
              aria-invalid={Boolean(errors.title)}
              required
            />
          </Field>

          <Field
            label="Description"
            htmlFor="requirementDescription"
            error={errors.requirementDescription}
            className="sm:col-span-2"
          >
            <Textarea
              id="requirementDescription"
              name="requirementDescription"
              defaultValue={lead.requirementDescription ?? ''}
            />
          </Field>

          <Field label="Primary contact" htmlFor="primaryContactId">
            <Select
              id="primaryContactId"
              name="primaryContactId"
              defaultValue={lead.primaryContactId ?? ''}
            >
              <option value="">Not set</option>
              {options.contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Source" htmlFor="sourceId">
            <Select
              id="sourceId"
              name="sourceId"
              defaultValue={lead.sourceId ?? ''}
            >
              <option value="">Not set</option>
              {options.sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </Select>
          </Field>

          {layout.showProduct ? (
            <Field label="Product" htmlFor="productId">
              <Select
                id="productId"
                name="productId"
                defaultValue={lead.productId ?? ''}
              >
                <option value="">Not set</option>
                {options.products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <Field
            label={`Expected budget (${currencySymbol})`}
            htmlFor="expectedBudget"
            error={errors.expectedBudget}
          >
            <Input
              id="expectedBudget"
              name="expectedBudget"
              inputMode="decimal"
              defaultValue={lead.expectedBudget ?? ''}
            />
          </Field>

          {canSetDealValue ? (
            <Field
              label={`Deal value (${currencySymbol})`}
              htmlFor="dealValue"
              hint="The agreed value, once there is one."
              error={errors.dealValue}
            >
              <Input
                id="dealValue"
                name="dealValue"
                inputMode="decimal"
                defaultValue={lead.dealValue ?? ''}
              />
            </Field>
          ) : null}

          <Field
            label="Expected timeline"
            htmlFor="expectedTimeline"
            error={errors.expectedTimeline}
          >
            <Input
              id="expectedTimeline"
              name="expectedTimeline"
              defaultValue={lead.expectedTimeline ?? ''}
            />
          </Field>

          <Field label="Priority" htmlFor="priority">
            <Select id="priority" name="priority" defaultValue={lead.priority}>
              {PRIORITY_ORDER.map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_LABELS[priority]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card title="Dates and additional information">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Next follow-up"
            htmlFor="nextFollowUpAt"
            error={errors.nextFollowUpAt}
          >
            <Input
              id="nextFollowUpAt"
              name="nextFollowUpAt"
              type="date"
              defaultValue={toDateInputValue(lead.nextFollowUpAt)}
            />
          </Field>

          <Field
            label="Expected close date"
            htmlFor="expectedCloseDate"
            error={errors.expectedCloseDate}
          >
            <Input
              id="expectedCloseDate"
              name="expectedCloseDate"
              type="date"
              defaultValue={toDateInputValue(lead.expectedCloseDate)}
            />
          </Field>

          {layout.showCampaign ? (
            <Field
              label="Campaign name"
              htmlFor="campaignName"
              error={errors.campaignName}
            >
              <Input
                id="campaignName"
                name="campaignName"
                defaultValue={lead.campaignName ?? ''}
              />
            </Field>
          ) : null}

          {layout.reference ? (
            <Field
              label={layout.reference.label}
              htmlFor="referenceUrl"
              hint={layout.reference.hint}
              error={errors.referenceUrl}
            >
              <Input
                id="referenceUrl"
                name="referenceUrl"
                defaultValue={lead.referenceUrl ?? ''}
              />
            </Field>
          ) : null}

          <Field
            label="Notes"
            htmlFor="additionalNotes"
            error={errors.additionalNotes}
            className="sm:col-span-2"
          >
            <Textarea
              id="additionalNotes"
              name="additionalNotes"
              defaultValue={lead.additionalNotes ?? ''}
            />
          </Field>
        </div>
      </Card>

      <div className="flex gap-2">
        <SubmitButton>Save changes</SubmitButton>
        <ButtonLink href={`/leads/${lead.id}`} variant="secondary">
          Cancel
        </ButtonLink>
      </div>
    </form>
  )
}
