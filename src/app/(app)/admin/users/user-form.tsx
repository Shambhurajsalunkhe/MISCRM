'use client'

import { useActionState } from 'react'

import type { UserRole } from '@/generated/prisma/enums'
import { Field, Input, Select, CheckboxField } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { ButtonLink } from '@/components/ui/button'
import { IDLE, type ActionState } from '@/lib/form'
import { ROLE_LABELS, ROLE_ORDER } from '@/lib/roles'

export type UserFormOptions = {
  departments: Array<{ id: string; name: string }>
  verticals: Array<{ id: string; name: string }>
  managers: Array<{ id: string; name: string; role: UserRole }>
}

export type UserFormValues = {
  id: string
  name: string
  email: string
  role: string
  employeeCode: string | null
  designation: string | null
  phone: string | null
  departmentId: string | null
  verticalId: string | null
  reportingManagerId: string | null
  isActive: boolean
}

export function UserForm({
  action,
  options,
  user,
  submitLabel,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  options: UserFormOptions
  /** Absent when creating. */
  user?: UserFormValues
  submitLabel: string
}) {
  const [state, formAction] = useActionState(action, IDLE)
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-5">
      {user ? <input type="hidden" name="id" value={user.id} /> : null}

      <FormMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="name" error={errors.name} required>
          <Input
            id="name"
            name="name"
            defaultValue={user?.name}
            aria-invalid={Boolean(errors.name)}
            autoComplete="off"
            required
          />
        </Field>

        <Field
          label="Email address"
          htmlFor="email"
          error={errors.email}
          hint="Used to sign in."
          required
        >
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={user?.email}
            aria-invalid={Boolean(errors.email)}
            autoComplete="off"
            required
          />
        </Field>

        <Field label="Role" htmlFor="role" error={errors.role} required>
          <Select
            id="role"
            name="role"
            defaultValue={user?.role ?? 'BDE'}
            aria-invalid={Boolean(errors.role)}
          >
            {ROLE_ORDER.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Designation"
          htmlFor="designation"
          error={errors.designation}
          hint="Job title as it appears on the org chart."
        >
          <Input
            id="designation"
            name="designation"
            defaultValue={user?.designation ?? ''}
          />
        </Field>

        <Field
          label="Employee code"
          htmlFor="employeeCode"
          error={errors.employeeCode}
        >
          <Input
            id="employeeCode"
            name="employeeCode"
            defaultValue={user?.employeeCode ?? ''}
            aria-invalid={Boolean(errors.employeeCode)}
          />
        </Field>

        <Field label="Phone" htmlFor="phone" error={errors.phone}>
          <Input
            id="phone"
            name="phone"
            defaultValue={user?.phone ?? ''}
            autoComplete="off"
          />
        </Field>

        <Field
          label="Department"
          htmlFor="departmentId"
          error={errors.departmentId}
        >
          <Select
            id="departmentId"
            name="departmentId"
            defaultValue={user?.departmentId ?? ''}
          >
            <option value="">— None —</option>
            {options.departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Vertical"
          htmlFor="verticalId"
          error={errors.verticalId}
          hint="Fixes which vertical this person creates leads in. Leave unset for somebody who works all of them."
        >
          <Select
            id="verticalId"
            name="verticalId"
            defaultValue={user?.verticalId ?? ''}
          >
            <option value="">— All verticals —</option>
            {options.verticals.map((vertical) => (
              <option key={vertical.id} value={vertical.id}>
                {vertical.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Reporting manager"
          htmlFor="reportingManagerId"
          error={errors.reportingManagerId}
          hint="Drives what this person's manager can see."
          className="sm:col-span-2"
        >
          <Select
            id="reportingManagerId"
            name="reportingManagerId"
            defaultValue={user?.reportingManagerId ?? ''}
            aria-invalid={Boolean(errors.reportingManagerId)}
          >
            <option value="">— None —</option>
            {options.managers
              .filter((manager) => manager.id !== user?.id)
              .map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {manager.name} · {ROLE_LABELS[manager.role]}
                </option>
              ))}
          </Select>
        </Field>
      </div>

      {user ? null : (
        <div className="grid gap-4 border-t border-slate-200 pt-5 sm:grid-cols-2">
          <Field
            label="Initial password"
            htmlFor="password"
            error={errors.password}
            hint="At least 10 characters. Share it over a channel they already trust."
            required
          >
            <Input
              id="password"
              name="password"
              type="password"
              aria-invalid={Boolean(errors.password)}
              autoComplete="new-password"
              required
            />
          </Field>

          <div className="flex items-end pb-1">
            <CheckboxField
              name="isActive"
              label="Active — can sign in immediately"
              defaultChecked
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-slate-200 pt-5">
        <SubmitButton>{submitLabel}</SubmitButton>
        <ButtonLink href="/admin/users" variant="secondary">
          Cancel
        </ButtonLink>
      </div>
    </form>
  )
}
