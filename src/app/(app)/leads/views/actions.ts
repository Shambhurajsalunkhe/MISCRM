'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/lib/db'
import { withAudit } from '@/lib/action'
import { can } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { LEAD_FILTER_KEYS } from '../filters'
import {
  actionError,
  actionSuccess,
  checkboxValue,
  type ActionState,
} from '@/lib/form'

/**
 * Saved views (README §30) — a named filter combination on the lead list.
 *
 * A view stores the filter *values*, not a rendered query string, so it keeps
 * working if a filter is added or renamed later. Only keys the list understands
 * are stored: `SavedView.filters` is a `Json` column, and anything else put in
 * it would be read straight back out into a URL.
 */

const nameSchema = z
  .string()
  .trim()
  .min(2, 'Give the view a name.')
  .max(60, 'Keep the name short enough to fit the list.')

export async function saveViewAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.LEAD_VIEW, async (actor) => {
    const parsedName = nameSchema.safeParse(formData.get('name') ?? '')
    if (!parsedName.success) {
      return actionError(parsedName.error.issues[0]?.message ?? 'Invalid name.', {
        name: parsedName.error.issues[0]?.message,
      })
    }

    const filters: Record<string, string> = {}
    for (const key of LEAD_FILTER_KEYS) {
      const value = formData.get(key)
      if (typeof value === 'string' && value.trim() !== '') {
        filters[key] = value.trim()
      }
    }

    if (Object.keys(filters).length === 0) {
      return actionError('Set some filters before saving a view.')
    }

    // Sharing a view shares a *filter*, never the rows: whoever opens it still
    // sees only what their own scope allows. Even so it is gated on the export
    // permission, because a shared view named "Acme renewal — $400k" tells
    // people something even when they cannot open a single lead in it.
    const isShared =
      checkboxValue(formData, 'isShared') &&
      (await can(actor, PERMISSIONS.DATA_EXPORT))

    await prisma.savedView.upsert({
      where: {
        userId_name_entity: {
          userId: actor.id,
          name: parsedName.data,
          entity: 'LEAD',
        },
      },
      create: {
        userId: actor.id,
        name: parsedName.data,
        entity: 'LEAD',
        filters,
        isShared,
      },
      update: { filters, isShared },
    })

    revalidatePath('/leads')
    return actionSuccess(`View “${parsedName.data}” saved.`)
  })
}

export async function deleteViewAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.LEAD_VIEW, async (actor) => {
    const id = formData.get('id')
    if (typeof id !== 'string' || id === '') return actionError('Missing view id.')

    const view = await prisma.savedView.findUnique({
      where: { id },
      select: { userId: true, name: true },
    })
    if (!view) return actionError('That view no longer exists.')

    // Shared views are visible to everyone but remain their author's to remove.
    if (view.userId !== actor.id) {
      return actionError('You can only delete views you created.')
    }

    await prisma.savedView.delete({ where: { id } })

    revalidatePath('/leads')
    return actionSuccess(`View “${view.name}” deleted.`)
  })
}
