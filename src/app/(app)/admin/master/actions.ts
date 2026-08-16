'use server'

import { revalidatePath } from 'next/cache'

import { withAudit } from '@/lib/action'
import { PERMISSIONS } from '@/lib/permissions'
import {
  actionError,
  actionSuccess,
  formValues,
  type ActionState,
} from '@/lib/form'
import { masterEntity } from './registry'

/**
 * The save and deactivate actions shared by every registry-driven master list.
 *
 * The entity slug travels in the form body. It is looked up against the
 * registry rather than used to reach a Prisma model by name, so an unexpected
 * value fails closed with "unknown list" instead of touching anything.
 */
export async function saveMasterAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ADMIN_MASTER, async () => {
    const slug = formData.get('entity')
    const entity = typeof slug === 'string' ? masterEntity(slug) : null
    if (!entity) return actionError('Unknown list.')

    const rawId = formData.get('id')
    const id = typeof rawId === 'string' && rawId !== '' ? rawId : null
    const values = formValues(formData)

    for (const field of entity.fields) {
      if (field.required && (values[field.name]?.trim() ?? '') === '') {
        return actionError(`${field.label} is required.`, {
          [field.name]: 'Required.',
        })
      }
    }

    const failure = await entity.save(id, values)
    if (failure) {
      return actionError(
        failure.message,
        failure.field ? { [failure.field]: failure.message } : undefined,
      )
    }

    revalidatePath(`/admin/master/${entity.slug}`)
    // The index card for this list shows an active-row count.
    revalidatePath('/admin/master')
    return actionSuccess(
      id ? 'Changes saved.' : `${values.name?.trim()} added.`,
    )
  })
}

export async function setMasterActiveAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ADMIN_MASTER, async () => {
    const slug = formData.get('entity')
    const entity = typeof slug === 'string' ? masterEntity(slug) : null
    if (!entity) return actionError('Unknown list.')

    const id = formData.get('id')
    if (typeof id !== 'string' || id === '') return actionError('Missing id.')

    const isActive = formData.get('isActive') === 'true'
    await entity.setActive(id, isActive)

    revalidatePath(`/admin/master/${entity.slug}`)
    revalidatePath('/admin/master')
    return actionSuccess(
      isActive
        ? `The ${entity.noun} is active again.`
        : `Deactivated. Existing records keep this ${entity.noun}; it just stops appearing in the pickers.`,
    )
  })
}
