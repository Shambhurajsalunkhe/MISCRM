'use client'

import { useActionState } from 'react'

import { ButtonLink } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { IDLE } from '@/lib/form'
import { saveTeamAction } from './actions'

export function TeamForm({
  team,
  departments,
  managers,
}: {
  team?: {
    id: string
    name: string
    departmentId: string | null
    managerId: string | null
  }
  departments: Array<{ id: string; name: string }>
  managers: Array<{ id: string; name: string; roleLabel: string }>
}) {
  const [state, formAction] = useActionState(saveTeamAction, IDLE)
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-2">
      {team ? <input type="hidden" name="id" value={team.id} /> : null}

      <FormMessage state={state} />

      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-44 flex-1">
          <label htmlFor="team-name" className="sr-only">
            Team name
          </label>
          <Input
            id="team-name"
            name="name"
            defaultValue={team?.name ?? ''}
            placeholder="Team name"
            aria-invalid={Boolean(errors.name)}
            autoFocus
            required
          />
          {errors.name ? (
            <p className="mt-1 text-xs text-red-600">{errors.name}</p>
          ) : null}
        </div>

        <div className="min-w-40">
          <label htmlFor="team-department" className="sr-only">
            Department
          </label>
          <Select
            id="team-department"
            name="departmentId"
            defaultValue={team?.departmentId ?? ''}
          >
            <option value="">No department</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="min-w-48">
          <label htmlFor="team-manager" className="sr-only">
            Team manager
          </label>
          <Select
            id="team-manager"
            name="managerId"
            defaultValue={team?.managerId ?? ''}
          >
            <option value="">No manager</option>
            {managers.map((manager) => (
              <option key={manager.id} value={manager.id}>
                {manager.name} · {manager.roleLabel}
              </option>
            ))}
          </Select>
        </div>

        <SubmitButton>{team ? 'Save' : 'Add'}</SubmitButton>
        <ButtonLink href="/admin/teams" variant="secondary">
          Cancel
        </ButtonLink>
      </div>
    </form>
  )
}
