'use client'

import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'

import { ButtonLink } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormMessage, SubmitButton, WarningList } from '@/components/ui/form'
import { Card } from '@/components/ui/page'
import { PRIORITY_LABELS, PRIORITY_ORDER } from '@/lib/leads/display'
import type { LeadFormLayout } from '@/lib/leads/vertical-form'
import { IDLE } from '@/lib/form'
import { createLeadAction } from '../actions'

export type LeadFormClient = {
  id: string
  label: string
  contacts: Array<{ id: string; label: string; isPrimary: boolean }>
}

/**
 * Has the user typed anything worth warning them about losing?
 *
 * Only text-like inputs count. Selects and checkboxes carry a default the user
 * may never have touched, and treating those as "content" would put a
 * confirmation dialog in front of someone who has done nothing but open the
 * page and pick a vertical.
 */
function hasTypedContent(form: HTMLFormElement | null): boolean {
  if (!form) return false

  return Array.from(
    form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input[type="text"], input[type="email"], input[type="date"], input:not([type]), textarea',
    ),
  ).some((field) => field.value.trim() !== '')
}

export type LeadFormOptions = {
  verticals: Array<{ id: string; name: string }>
  sources: Array<{ id: string; name: string }>
  products: Array<{ id: string; name: string }>
  countries: Array<{ id: string; name: string }>
  users: Array<{ id: string; name: string; roleLabel: string }>
  clients: LeadFormClient[]
  /** True when the client list was capped — see the hint under the picker. */
  clientsTruncated: boolean
  /** Recent counter batches for this vertical. Empty where none are counted. */
  sourceActivities: Array<{ id: string; label: string }>
}

/**
 * The lead creation form (README §6).
 *
 * The vertical picker navigates rather than switching sections client-side: the
 * stage list, sources and lost reasons are all per-vertical, so the sections
 * that change are the ones whose *contents* come from the database. Re-rendering
 * on the server is both simpler and correct, and it puts the choice in the URL
 * so `/leads/new?vertical=…` is linkable.
 */
export function LeadForm({
  layout,
  verticalId,
  options,
  defaultClientId,
}: {
  layout: LeadFormLayout
  verticalId: string
  options: LeadFormOptions
  defaultClientId?: string
}) {
  const router = useRouter()
  const [state, formAction] = useActionState(createLeadAction, IDLE)
  const errors = state.fieldErrors ?? {}

  const [clientId, setClientId] = useState(defaultClientId ?? '')
  // Opens on the new-lead branch unless the form was opened from a client
  // (`/leads/new?clientId=`), which says the account is already on file. Most
  // leads are somebody nobody has dealt with yet, so the branch that needs
  // typing is the one to show first.
  const [newCompany, setNewCompany] = useState(!defaultClientId)
  const needsOverride = (state.warnings?.length ?? 0) > 0

  const contacts =
    options.clients.find((client) => client.id === clientId)?.contacts ?? []

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="verticalId" value={verticalId} />

      <FormMessage state={state} />
      <WarningList state={state} />

      <Card
        title="Vertical"
        description="Decides the lead code prefix, the stage list this lead follows and which modules it exposes. It cannot be changed afterwards — its stage history would no longer line up."
      >
        {options.verticals.length === 1 ? (
          // Fenced to one vertical, so there is nothing to choose. A disabled
          // select would look like a control that had stopped working; a
          // sentence says the same thing and does not invite a click. The
          // hidden verticalId above still carries it.
          <p className="text-sm text-slate-700">
            <span className="font-medium">{options.verticals[0].name}</span>
            <span className="text-slate-500">
              {' '}
              — the vertical you work. Every lead you create is filed here.
            </span>
          </p>
        ) : (
        <Field label="Vertical" htmlFor="vertical-picker" required>
          <Select
            id="vertical-picker"
            value={verticalId}
            onChange={(event) => {
              // Switching vertical reloads the page, which discards anything
              // already typed. Cheap to do by accident on a select, and
              // expensive when the requirement description is three paragraphs
              // in — so ask first, and only when there is something to lose.
              if (
                hasTypedContent(event.currentTarget.form) &&
                !window.confirm(
                  'Changing the vertical reloads the form and clears what you have entered. Continue?',
                )
              ) {
                return
              }

              const next = new URLSearchParams({ vertical: event.target.value })
              if (clientId) next.set('clientId', clientId)
              router.push(`/leads/new?${next.toString()}`)
            }}
          >
            {options.verticals.map((vertical) => (
              <option key={vertical.id} value={vertical.id}>
                {vertical.name}
              </option>
            ))}
          </Select>
        </Field>
        )}

        {layout.afterCreateNote ? (
          <p className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
            {layout.afterCreateNote}
          </p>
        ) : null}
      </Card>

      <Card
        title="Who it is for"
        description="Nobody here is a client yet, which is why the second option is a lead rather than a customer. A returning customer, on the other hand, gets a new lead against the account we already have, never a second record."
      >
        {/*
         * Both routes in are shown up front. The new-company branch used to be
         * reachable only through a grey text link under the picker, which read as
         * a caption rather than a control — people concluded the lead form could
         * not create a client at all and went to /clients first. Two visible
         * options cost one row and remove the guess.
         */}
        <div
          role="radiogroup"
          aria-label="Client"
          className="mb-4 inline-flex rounded-md border border-slate-300 p-0.5"
        >
          {[
            { value: false, label: 'Existing client' },
            { value: true, label: 'New lead' },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={newCompany === option.value}
              onClick={() => {
                setNewCompany(option.value)
                if (option.value) setClientId('')
              }}
              className={
                newCompany === option.value
                  ? 'rounded px-3 py-1.5 text-sm font-medium bg-slate-900 text-white'
                  : 'rounded px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900'
              }
            >
              {option.label}
            </button>
          ))}
        </div>

        {newCompany ? (
          <div className="space-y-4">
            {needsOverride ? (
              <Field
                label="Create it anyway — why is this a separate company?"
                htmlFor="overrideReason"
                hint="Recorded in the audit trail."
                required
              >
                <Input
                  id="overrideReason"
                  name="overrideReason"
                  placeholder="e.g. different subsidiary, separate billing entity"
                  required
                />
              </Field>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Lead name"
                htmlFor="clientName"
                hint="A person or a firm. It becomes the client record if the deal is won."
                error={errors.clientName}
                required
              >
                <Input
                  id="clientName"
                  name="clientName"
                  aria-invalid={Boolean(errors.clientName)}
                  required
                />
              </Field>

              {/*
               * Second, and optional on every vertical. Staffing and Product
               * Sales usually know the firm; an Upwork or LinkedIn client is a
               * name and an inbox for weeks before anyone learns it.
               */}
              <Field
                label="Company name"
                htmlFor="companyName"
                hint="If the client is a registered company."
                error={errors.companyName}
              >
                <Input id="companyName" name="companyName" />
              </Field>

              <Field label="Website" htmlFor="website" error={errors.website}>
                <Input id="website" name="website" placeholder="acme.com" />
              </Field>

              <Field label="Country" htmlFor="countryId">
                <Select id="countryId" name="countryId" defaultValue="">
                  <option value="">Not set</option>
                  {options.countries.map((country) => (
                    <option key={country.id} value={country.id}>
                      {country.name}
                    </option>
                  ))}
                </Select>
              </Field>

              {/*
               * No contact name here. The client name above is the contact's
               * name whenever the client is a person, which outside Staffing and
               * Product Sales it usually is — so the field asked most people to
               * type the same thing twice. An email or a phone still creates the
               * primary contact; see resolveClient in ../actions.ts, which names
               * it after the client. A separately-named contact is added on the
               * client page, where a company can have several.
               */}
              <Field
                label="Contact email"
                htmlFor="contactEmail"
                hint="Either of these saves a primary contact under the client name above."
                error={errors.contactEmail}
              >
                <Input id="contactEmail" name="contactEmail" type="email" />
              </Field>

              <Field
                label="Contact phone"
                htmlFor="contactPhone"
                hint="Rename the contact, or add more, from the client page."
                error={errors.contactPhone}
              >
                <Input id="contactPhone" name="contactPhone" />
              </Field>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Client"
                htmlFor="clientId"
                error={errors.clientId}
                hint={
                  options.clientsTruncated
                    ? 'Showing the most recent clients. If yours is missing, open it from Clients and use “New lead” there.'
                    : undefined
                }
                required
              >
                <Select
                  id="clientId"
                  name="clientId"
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  required
                >
                  <option value="">Choose a client</option>
                  {options.clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Primary contact"
                htmlFor="primaryContactId"
                error={errors.primaryContactId}
                hint={
                  clientId && contacts.length === 0
                    ? 'This client has no active contacts yet. Add one from the client page.'
                    : undefined
                }
              >
                <Select
                  id="primaryContactId"
                  name="primaryContactId"
                  defaultValue={
                    contacts.find((contact) => contact.isPrimary)?.id ?? ''
                  }
                  disabled={contacts.length === 0}
                  // Remount when the client changes, so the browser re-applies
                  // `defaultValue` instead of keeping the previous client's
                  // contact selected.
                  key={clientId}
                >
                  <option value="">Not set</option>
                  {contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        )}
      </Card>

      <Card title="Requirement">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Requirement"
            htmlFor="title"
            hint="One line, shown everywhere this lead appears in a list."
            error={errors.title}
            required
            className="sm:col-span-2"
          >
            <Input
              id="title"
              name="title"
              placeholder="React developer for a 6-month engagement"
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
            <Textarea id="requirementDescription" name="requirementDescription" />
          </Field>

          {/*
           * Product Sales picks from the product catalogue. Every other vertical
           * used to pick a service here; that field is gone — the requirement
           * line and its description are how the work is described, and a second
           * fixed taxonomy on top of them was one more thing to keep current
           * without changing what any report could answer.
           */}
          {layout.showProduct ? (
            <Field label="Product" htmlFor="productId">
              <Select id="productId" name="productId" defaultValue="">
                <option value="">Not set</option>
                {options.products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <Field label="Source" htmlFor="sourceId">
            <Select id="sourceId" name="sourceId" defaultValue="">
              <option value="">Not set</option>
              {options.sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Expected budget"
            htmlFor="expectedBudget"
            error={errors.expectedBudget}
          >
            <Input id="expectedBudget" name="expectedBudget" inputMode="decimal" />
          </Field>

          <Field
            label="Expected timeline"
            htmlFor="expectedTimeline"
            error={errors.expectedTimeline}
          >
            <Input
              id="expectedTimeline"
              name="expectedTimeline"
              placeholder="6 months"
            />
          </Field>

          <Field label="Priority" htmlFor="priority">
            <Select id="priority" name="priority" defaultValue="MEDIUM">
              {PRIORITY_ORDER.map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_LABELS[priority]}
                </option>
              ))}
            </Select>
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
            />
          </Field>
        </div>
      </Card>

      <Card
        title="Ownership"
        description="Who sourced it and who works it are separate on purpose — the BDE and BDM performance reports each read one of them."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Generated by"
            htmlFor="generatedById"
            hint="Defaults to you."
            error={errors.generatedById}
          >
            <Select id="generatedById" name="generatedById" defaultValue="">
              <option value="">You</option>
              {options.users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} · {user.roleLabel}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Assigned to"
            htmlFor="assignedToId"
            hint="Can be left unassigned and handed over later."
            error={errors.assignedToId}
          >
            <Select id="assignedToId" name="assignedToId" defaultValue="">
              <option value="">Unassigned</option>
              {options.users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} · {user.roleLabel}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card title="Additional information">
        <div className="grid gap-4 sm:grid-cols-2">
          {layout.showCampaign ? (
            <Field
              label="Campaign name"
              htmlFor="campaignName"
              error={errors.campaignName}
            >
              <Input id="campaignName" name="campaignName" />
            </Field>
          ) : null}

          {layout.reference ? (
            <Field
              label={layout.reference.label}
              htmlFor="referenceUrl"
              hint={layout.reference.hint}
              error={errors.referenceUrl}
            >
              <Input id="referenceUrl" name="referenceUrl" />
            </Field>
          ) : null}

          {options.sourceActivities.length > 0 ? (
            <Field
              label="Came from"
              htmlFor="sourceActivityId"
              hint="The day's outreach this response answered. Optional — it is what makes the pitch-to-response rate auditable rather than only statistical."
              error={errors.sourceActivityId}
              className="sm:col-span-2"
            >
              <Select id="sourceActivityId" name="sourceActivityId" defaultValue="">
                <option value="">Not linked</option>
                {options.sourceActivities.map((activity) => (
                  <option key={activity.id} value={activity.id}>
                    {activity.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <Field
            label="Next follow-up"
            htmlFor="nextFollowUpAt"
            error={errors.nextFollowUpAt}
          >
            <Input id="nextFollowUpAt" name="nextFollowUpAt" type="date" />
          </Field>

          <Field
            label="Notes"
            htmlFor="additionalNotes"
            error={errors.additionalNotes}
            className="sm:col-span-2"
          >
            <Textarea id="additionalNotes" name="additionalNotes" />
          </Field>
        </div>
      </Card>

      <div className="flex gap-2">
        <SubmitButton>
          {needsOverride ? 'Create anyway' : 'Create lead'}
        </SubmitButton>
        <ButtonLink href="/leads" variant="secondary">
          Cancel
        </ButtonLink>
      </div>
    </form>
  )
}
