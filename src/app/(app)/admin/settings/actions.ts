'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/lib/db'
import { withAudit } from '@/lib/action'
import { PERMISSIONS } from '@/lib/permissions'
import { actionError, actionSuccess, type ActionState } from '@/lib/form'
import { SETTING_DEFINITIONS, settingDefinition } from './definitions'

export async function saveSettingsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ADMIN_MASTER, async () => {
    const updates: Array<{ key: string; value: string }> = []
    const fieldErrors: Record<string, string> = {}

    for (const definition of SETTING_DEFINITIONS) {
      const raw = formData.get(definition.key)

      // A boolean setting's checkbox is absent when unticked; every other type
      // must actually be present in the payload.
      const value =
        definition.type === 'boolean'
          ? String(raw !== null)
          : typeof raw === 'string'
            ? raw.trim()
            : null

      if (value === null) continue

      const normalised = definition.normalise?.(value) ?? value

      // A `select` is only a hint to the browser. The value still arrives as
      // whatever was posted, so the option list is enforced here too —
      // otherwise `fiscal_year_start_month` could be set to 13, and every
      // year-to-date range on every report would quietly go wrong.
      if (definition.type === 'select') {
        const allowed = definition.options?.some(
          (option) => option.value === normalised,
        )
        if (!allowed) {
          fieldErrors[definition.key] = 'Choose one of the listed options.'
          continue
        }
      }

      const problem = definition.validate?.(normalised)
      if (problem) {
        fieldErrors[definition.key] = problem
        continue
      }

      updates.push({ key: definition.key, value: normalised })
    }

    if (Object.keys(fieldErrors).length > 0) {
      return actionError('Please correct the highlighted settings.', fieldErrors)
    }

    // Only write the ones that moved, so the audit trail shows the setting an
    // administrator actually changed rather than all six every time.
    const current = await prisma.appSetting.findMany({
      select: { key: true, value: true },
    })
    const currentByKey = new Map(current.map((row) => [row.key, row.value]))

    let changed = 0
    for (const update of updates) {
      if (currentByKey.get(update.key) === update.value) continue

      await prisma.appSetting.upsert({
        where: { key: update.key },
        update: { value: update.value },
        create: {
          key: update.key,
          value: update.value,
          description: settingDefinition(update.key)?.label,
        },
      })
      changed += 1
    }

    revalidatePath('/admin/settings')
    return changed === 0
      ? actionSuccess('No changes to save.')
      : actionSuccess(
          `${changed} setting${changed === 1 ? '' : 's'} updated.`,
        )
  })
}
