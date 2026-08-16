'use client'

import { Fragment, useActionState } from 'react'

import { Checkbox } from '@/components/ui/field'
import {
  ConfirmSubmitButton,
  FormMessage,
  SubmitButton,
} from '@/components/ui/form'
import { PERMISSION_GROUPS, PERMISSIONS, type Permission } from '@/lib/permissions'
import { ROLE_ORDER, ROLE_SHORT_LABELS } from '@/lib/roles'
import type { UserRole } from '@/generated/prisma/enums'
import { IDLE } from '@/lib/form'
import { resetPermissionsAction, savePermissionsAction } from './actions'

/** Mirrors `isLockoutRisk` on the server — see the note there. */
function isLocked(role: UserRole, permission: Permission): boolean {
  return (
    role === 'ADMIN' &&
    (permission === PERMISSIONS.ADMIN_MASTER ||
      permission === PERMISSIONS.ADMIN_USERS)
  )
}

export function PermissionMatrix({
  granted,
}: {
  /** Keys are `<ROLE>:<permission>`. */
  granted: Record<string, boolean>
}) {
  const [state, formAction] = useActionState(savePermissionsAction, IDLE)
  const [resetState, resetAction] = useActionState(resetPermissionsAction, IDLE)

  return (
    <div className="space-y-4">
      <FormMessage state={state} />
      <FormMessage state={resetState} />

      {/* The checkboxes are uncontrolled, so React keeps whatever the DOM
          currently holds and `defaultChecked` is only read on mount. After
          "Reset to defaults" revalidates, the server sends new `granted` values
          that the existing inputs would ignore, leaving the grid showing the
          pre-reset state until a hard reload. Keying the form on the server
          state forces a remount so the new defaults actually apply. */}
      <form
        key={JSON.stringify(granted)}
        action={formAction}
        className="space-y-4"
      >
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Capability
                </th>
                {ROLE_ORDER.map((role) => (
                  <th
                    key={role}
                    scope="col"
                    className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    {ROLE_SHORT_LABELS[role]}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {PERMISSION_GROUPS.map((group) => (
                <Fragment key={group.heading}>
                  <tr className="bg-slate-50/60">
                    <th
                      scope="colgroup"
                      colSpan={ROLE_ORDER.length + 1}
                      className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                    >
                      {group.heading}
                    </th>
                  </tr>

                  {group.permissions.map((meta) => (
                    <tr key={meta.permission} className="hover:bg-slate-50/70">
                      <th
                        scope="row"
                        className="px-3 py-2 text-left font-normal text-slate-700"
                      >
                        {meta.label}
                        {meta.scoped ? (
                          <span
                            className="ml-1.5 cursor-help text-xs text-slate-400"
                            title="Scope still applies: this role only reaches their own records, or their team's."
                          >
                            ◐
                          </span>
                        ) : null}
                        <span className="ml-2 font-mono text-[11px] text-slate-400">
                          {meta.permission}
                        </span>
                      </th>

                      {ROLE_ORDER.map((role) => {
                        const name = `perm:${role}:${meta.permission}`
                        const locked = isLocked(role, meta.permission)

                        return (
                          <td key={role} className="px-3 py-2 text-center">
                            <Checkbox
                              name={name}
                              defaultChecked={
                                locked ||
                                granted[`${role}:${meta.permission}`] === true
                              }
                              disabled={locked}
                              aria-label={`${meta.label} for ${ROLE_SHORT_LABELS[role]}`}
                              title={
                                locked
                                  ? 'Fixed: removing this would lock every administrator out of this screen.'
                                  : undefined
                              }
                            />
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-2">
          <SubmitButton>Save matrix</SubmitButton>
          <p className="text-xs text-slate-500">
            ◐ marks capabilities where record-level scope still applies on top
            of the tick.
          </p>
        </div>
      </form>

      <form action={resetAction} className="border-t border-slate-200 pt-4">
        <ConfirmSubmitButton
          variant="secondary"
          size="sm"
          confirmMessage="Reset every role back to its default capabilities? Any customisation you have made here is discarded."
        >
          Reset to defaults
        </ConfirmSubmitButton>
      </form>
    </div>
  )
}
