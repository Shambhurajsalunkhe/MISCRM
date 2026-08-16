'use client'

import { useActionState } from 'react'

import { ButtonLink } from '@/components/ui/button'
import {
  CheckboxField,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui/field'
import {
  FormMessage,
  SubmitButton,
  WarningList,
} from '@/components/ui/form'
import { Card } from '@/components/ui/page'
import { IDLE } from '@/lib/form'
import { createClientAction, updateClientAction } from './actions'

export type ClientFormValues = {
  id: string
  companyName: string
  website: string | null
  companyLinkedIn: string | null
  industry: string | null
  countryId: string | null
  city: string | null
  address: string | null
  ownerId: string | null
  isActive: boolean
}

/**
 * Create and edit in one component.
 *
 * The two differ in three details — the action, whether the first-contact
 * section is shown, and whether `isActive` is offered — and are otherwise the
 * same twenty fields. Splitting them would mean maintaining that twice.
 */
export function ClientForm({
  client,
  countries,
  owners,
}: {
  client?: ClientFormValues
  countries: Array<{ id: string; name: string }>
  owners: Array<{ id: string; name: string; roleLabel: string }>
}) {
  const [state, formAction] = useActionState(
    client ? updateClientAction : createClientAction,
    IDLE,
  )
  const errors = state.fieldErrors ?? {}
  const needsOverride = (state.warnings?.length ?? 0) > 0

  return (
    <form action={formAction} className="space-y-4">
      {client ? <input type="hidden" name="id" value={client.id} /> : null}

      <FormMessage state={state} />
      <WarningList state={state} />

      {needsOverride ? (
        <Field
          label="Save anyway — why is this a separate record?"
          htmlFor="overrideReason"
          hint="Recorded in the audit trail against this client."
          required
        >
          <Input
            id="overrideReason"
            name="overrideReason"
            placeholder="e.g. different subsidiary, separate billing entity"
            autoFocus
            required
          />
        </Field>
      ) : null}

      <Card title="Company">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Company name"
            htmlFor="companyName"
            error={errors.companyName}
            required
            className="sm:col-span-2"
          >
            <Input
              id="companyName"
              name="companyName"
              defaultValue={client?.companyName ?? ''}
              aria-invalid={Boolean(errors.companyName)}
              required
            />
          </Field>

          <Field label="Website" htmlFor="website" error={errors.website}>
            <Input
              id="website"
              name="website"
              defaultValue={client?.website ?? ''}
              placeholder="acme.com"
            />
          </Field>

          <Field
            label="Company LinkedIn"
            htmlFor="companyLinkedIn"
            error={errors.companyLinkedIn}
          >
            <Input
              id="companyLinkedIn"
              name="companyLinkedIn"
              defaultValue={client?.companyLinkedIn ?? ''}
              placeholder="linkedin.com/company/acme"
            />
          </Field>

          <Field label="Industry" htmlFor="industry" error={errors.industry}>
            <Input
              id="industry"
              name="industry"
              defaultValue={client?.industry ?? ''}
            />
          </Field>

          <Field label="Country" htmlFor="countryId">
            <Select
              id="countryId"
              name="countryId"
              defaultValue={client?.countryId ?? ''}
            >
              <option value="">Not set</option>
              {countries.map((country) => (
                <option key={country.id} value={country.id}>
                  {country.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="City" htmlFor="city" error={errors.city}>
            <Input id="city" name="city" defaultValue={client?.city ?? ''} />
          </Field>

          <Field
            label="Account owner"
            htmlFor="ownerId"
            hint="Who holds the relationship. Also decides who can see the account before it has leads."
          >
            <Select
              id="ownerId"
              name="ownerId"
              defaultValue={client?.ownerId ?? ''}
            >
              <option value="">Unassigned</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name} · {owner.roleLabel}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Address"
            htmlFor="address"
            error={errors.address}
            className="sm:col-span-2"
          >
            <Textarea
              id="address"
              name="address"
              defaultValue={client?.address ?? ''}
            />
          </Field>
        </div>
      </Card>

      {client ? (
        <Card title="Status">
          <CheckboxField
            label="Active"
            name="isActive"
            hint="Inactive clients stay in reports but are hidden from the lead form’s picker."
            defaultChecked={client.isActive}
          />
        </Card>
      ) : (
        <Card
          title="First contact"
          description="Optional, and addable later. Worth filling in now: the email domain sharpens duplicate detection for everyone who touches this account after you."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="contactName" error={errors.contactName}>
              <Input id="contactName" name="contactName" />
            </Field>

            <Field
              label="Designation"
              htmlFor="contactDesignation"
              error={errors.contactDesignation}
            >
              <Input id="contactDesignation" name="contactDesignation" />
            </Field>

            <Field label="Email" htmlFor="contactEmail" error={errors.contactEmail}>
              <Input
                id="contactEmail"
                name="contactEmail"
                type="email"
                aria-invalid={Boolean(errors.contactEmail)}
              />
            </Field>

            <Field label="Phone" htmlFor="contactPhone" error={errors.contactPhone}>
              <Input id="contactPhone" name="contactPhone" />
            </Field>

            <Field
              label="LinkedIn profile"
              htmlFor="contactLinkedIn"
              error={errors.contactLinkedIn}
              className="sm:col-span-2"
            >
              <Input id="contactLinkedIn" name="contactLinkedIn" />
            </Field>
          </div>
        </Card>
      )}

      <div className="flex gap-2">
        <SubmitButton>
          {client ? 'Save changes' : needsOverride ? 'Save anyway' : 'Create client'}
        </SubmitButton>
        <ButtonLink
          href={client ? `/clients/${client.id}` : '/clients'}
          variant="secondary"
        >
          Cancel
        </ButtonLink>
      </div>
    </form>
  )
}
