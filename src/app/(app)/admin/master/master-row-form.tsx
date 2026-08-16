'use client'

import { useActionState } from 'react'

import { ButtonLink } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { IDLE } from '@/lib/form'
import { saveMasterAction } from './actions'
import type { MasterField, SelectOption } from './registry'

/**
 * The inline add/edit row shared by every registry-driven master list.
 *
 * Fields are rendered from the entity's descriptor, so adding a column to a
 * list is a change in `registry.ts` and nowhere else.
 */
export function MasterRowForm({
  slug,
  fields,
  options,
  row,
  columnCount,
}: {
  slug: string
  fields: MasterField[]
  options: Record<string, SelectOption[]>
  row?: { id: string; values: Record<string, string> }
  /** Only used to size the "Cancel" link's row when embedded in a table. */
  columnCount?: number
}) {
  const [state, formAction] = useActionState(saveMasterAction, IDLE)
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-2" data-columns={columnCount}>
      <input type="hidden" name="entity" value={slug} />
      {row ? <input type="hidden" name="id" value={row.id} /> : null}

      <FormMessage state={state} />

      <div className="flex flex-wrap items-start gap-2">
        {fields.map((field, index) => {
          const inputId = `${slug}-${row?.id ?? 'new'}-${field.name}`
          const error = errors[field.name]
          const defaultValue = row?.values[field.name] ?? ''

          return (
            <div key={field.name} className="min-w-40 flex-1">
              <label htmlFor={inputId} className="sr-only">
                {field.label}
              </label>

              {field.type === 'select' ? (
                <Select
                  id={inputId}
                  name={field.name}
                  defaultValue={defaultValue}
                  aria-invalid={Boolean(error)}
                >
                  <option value="">
                    {field.hint ?? `— No ${field.label.toLowerCase()} —`}
                  </option>
                  {(options[field.optionsKey ?? ''] ?? []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  id={inputId}
                  name={field.name}
                  // Deliberately `text` even for numbers: `type="number"`
                  // silently drops a value the browser considers invalid, so a
                  // typo would submit as blank rather than reaching the
                  // server's own check and being explained.
                  type="text"
                  inputMode={field.type === 'number' ? 'decimal' : undefined}
                  defaultValue={defaultValue}
                  placeholder={field.placeholder ?? field.label}
                  aria-invalid={Boolean(error)}
                  autoFocus={index === 0}
                  required={field.required}
                />
              )}

              {error ? (
                <p className="mt-1 text-xs text-red-600">{error}</p>
              ) : field.hint && field.type !== 'select' ? (
                <p className="mt-1 text-xs text-slate-500">{field.hint}</p>
              ) : null}
            </div>
          )
        })}

        <SubmitButton>{row ? 'Save' : 'Add'}</SubmitButton>
        <ButtonLink href={`/admin/master/${slug}`} variant="secondary">
          Cancel
        </ButtonLink>
      </div>
    </form>
  )
}
