'use client'

import { useActionState } from 'react'

import { CheckboxField, Field, Input, Select } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { IDLE } from '@/lib/form'
import { saveSettingsAction } from './actions'
import { SETTING_GROUPS } from './definitions'

export function SettingsForm({
  values,
}: {
  values: Record<string, string | undefined>
}) {
  const [state, formAction] = useActionState(saveSettingsAction, IDLE)
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-6">
      <FormMessage state={state} />

      {SETTING_GROUPS.map((group) => (
        <section
          key={group.heading}
          className="rounded-lg border border-slate-200 bg-white"
        >
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">
              {group.heading}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">{group.description}</p>
          </div>

          <div className="grid gap-4 p-4 sm:grid-cols-2">
            {group.settings.map((setting) => {
              const value = values[setting.key]
              const error = errors[setting.key]

              if (setting.type === 'boolean') {
                return (
                  <div key={setting.key} className="sm:col-span-2">
                    <CheckboxField
                      name={setting.key}
                      label={setting.label}
                      hint={setting.hint || undefined}
                      defaultChecked={value === 'true'}
                    />
                  </div>
                )
              }

              return (
                <Field
                  key={setting.key}
                  label={setting.label}
                  htmlFor={setting.key}
                  hint={setting.hint || undefined}
                  error={error}
                >
                  {setting.type === 'select' ? (
                    <Select
                      id={setting.key}
                      name={setting.key}
                      defaultValue={value ?? ''}
                      aria-invalid={Boolean(error)}
                    >
                      {setting.options?.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      id={setting.key}
                      name={setting.key}
                      defaultValue={value ?? ''}
                      aria-invalid={Boolean(error)}
                    />
                  )}
                </Field>
              )
            })}
          </div>
        </section>
      ))}

      <SubmitButton>Save settings</SubmitButton>
    </form>
  )
}
