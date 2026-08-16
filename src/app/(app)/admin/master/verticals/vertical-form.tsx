'use client'

import { useActionState } from 'react'

import { ButtonLink } from '@/components/ui/button'
import { CheckboxField, Field, Input } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { IDLE } from '@/lib/form'
import { saveVerticalAction } from './actions'

export type VerticalFormValues = {
  id: string
  name: string
  code: string
  leadPrefix: string
  colorHex: string
  sortOrder: number
  usesRequirements: boolean
  usesCandidates: boolean
  usesDemos: boolean
  usesQuotations: boolean
  usesContracts: boolean
  usesInvoicing: boolean
  leadCount: number
}

const MODULES: Array<{
  name: keyof VerticalFormValues
  label: string
  hint: string
}> = [
  {
    name: 'usesRequirements',
    label: 'Requirements',
    hint: 'Staffing: many requirements under one lead, each won or lost on its own.',
  },
  {
    name: 'usesCandidates',
    label: 'Candidates & submissions',
    hint: 'Staffing: the candidate master and the submission board.',
  },
  {
    name: 'usesDemos',
    label: 'Demos',
    hint: 'Product Sales: several demos can hang off one lead.',
  },
  {
    name: 'usesQuotations',
    label: 'Quotations',
    hint: 'Product Sales: quotations with line items.',
  },
  {
    name: 'usesContracts',
    label: 'Contracts',
    hint: 'Digital Marketing: signed contracts with a billing cycle.',
  },
  {
    name: 'usesInvoicing',
    label: 'Invoicing & payments',
    hint: 'Decision D6. Without this, the vertical reports deal value only — no collected or pending revenue.',
  },
]

export function VerticalForm({ vertical }: { vertical?: VerticalFormValues }) {
  const [state, formAction] = useActionState(saveVerticalAction, IDLE)
  const errors = state.fieldErrors ?? {}

  const prefixLocked = (vertical?.leadCount ?? 0) > 0

  return (
    <form action={formAction} className="space-y-5">
      {vertical ? <input type="hidden" name="id" value={vertical.id} /> : null}

      <FormMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Name"
          htmlFor="name"
          error={errors.name}
          required
          className="sm:col-span-2"
        >
          <Input
            id="name"
            name="name"
            defaultValue={vertical?.name ?? ''}
            aria-invalid={Boolean(errors.name)}
            required
          />
        </Field>

        <Field
          label="Code"
          htmlFor="code"
          error={errors.code}
          hint="Internal identifier, e.g. UP."
          required
        >
          <Input
            id="code"
            name="code"
            defaultValue={vertical?.code ?? ''}
            aria-invalid={Boolean(errors.code)}
            className="uppercase"
            required
          />
        </Field>

        <Field
          label="Lead prefix"
          htmlFor="leadPrefix"
          error={errors.leadPrefix}
          hint={
            prefixLocked
              ? `Locked — ${vertical?.leadCount} lead(s) already carry this prefix.`
              : 'Lead codes read PREFIX-0001.'
          }
          required
        >
          <Input
            id="leadPrefix"
            name="leadPrefix"
            defaultValue={vertical?.leadPrefix ?? ''}
            aria-invalid={Boolean(errors.leadPrefix)}
            className="uppercase"
            readOnly={prefixLocked}
            required
          />
        </Field>

        <Field
          label="Colour"
          htmlFor="colorHex"
          error={errors.colorHex}
          hint="Used on charts and badges."
          required
        >
          <Input
            id="colorHex"
            name="colorHex"
            defaultValue={vertical?.colorHex ?? '#64748B'}
            aria-invalid={Boolean(errors.colorHex)}
            placeholder="#64748B"
            required
          />
        </Field>

        <Field
          label="Sort order"
          htmlFor="sortOrder"
          error={errors.sortOrder}
          hint="Lowest first, everywhere verticals are listed."
          required
        >
          <Input
            id="sortOrder"
            name="sortOrder"
            inputMode="numeric"
            defaultValue={String(vertical?.sortOrder ?? 0)}
            aria-invalid={Boolean(errors.sortOrder)}
            required
          />
        </Field>
      </div>

      <fieldset className="border-t border-slate-200 pt-4">
        <legend className="sr-only">Modules</legend>
        <p className="mb-3 text-sm font-medium text-slate-700">
          Modules this vertical exposes
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((module) => (
            <CheckboxField
              key={module.name}
              name={module.name}
              label={module.label}
              hint={module.hint}
              defaultChecked={Boolean(vertical?.[module.name])}
            />
          ))}
        </div>
      </fieldset>

      <div className="flex gap-2 border-t border-slate-200 pt-4">
        <SubmitButton>{vertical ? 'Save vertical' : 'Add vertical'}</SubmitButton>
        <ButtonLink href="/admin/master/verticals" variant="secondary">
          Cancel
        </ButtonLink>
      </div>
    </form>
  )
}
