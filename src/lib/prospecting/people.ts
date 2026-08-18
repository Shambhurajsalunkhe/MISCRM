import 'server-only'

import { prisma } from '@/lib/db'
import { visibleUserIds } from '@/lib/visibility'
import { ROLE_SHORT_LABELS } from '@/lib/roles'
import type { CurrentUser } from '@/lib/auth/session'

/**
 * Whose counters a user may enter.
 *
 * The permission matrix has one row for prospecting — "Log prospecting
 * counters", held by everybody — and says nothing about logging on someone
 * else's behalf. Rather than invent a second permission, this reuses the data
 * scope of decision D7, which already answers the same question for every other
 * record in the app:
 *
 *   BDE    -> themselves only
 *   BDM    -> themselves and their reporting sub-tree
 *   ADMIN  -> anyone
 *
 * That is the behaviour the screen needs. A manager catching up a week for
 * someone who was travelling is normal; a BDE quietly editing a colleague's
 * pitch count is not, and BDE Performance (README §27) is read off exactly
 * these numbers.
 */

export type LoggablePerson = { id: string; name: string; roleLabel: string }

export async function loggablePeople(
  user: CurrentUser,
): Promise<LoggablePerson[]> {
  const ids = await visibleUserIds(user)

  const rows = await prisma.user.findMany({
    where: { isActive: true, ...(ids ? { id: { in: ids } } : {}) },
    select: { id: true, name: true, role: true },
    orderBy: { name: 'asc' },
  })

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    roleLabel: ROLE_SHORT_LABELS[row.role],
  }))
}

/**
 * Resolve the person a counter entry is for, defaulting to the actor.
 *
 * Returns `null` when the target is outside the actor's scope or deactivated,
 * which the caller turns into a refusal. Checked server-side on every save and
 * not only when rendering the picker: the picker is a convenience, this is the
 * control.
 */
export async function resolveCounterOwner(
  actor: CurrentUser,
  requestedId: string | null,
): Promise<{ id: string; name: string } | null> {
  if (!requestedId || requestedId === actor.id) {
    return { id: actor.id, name: actor.name }
  }

  const ids = await visibleUserIds(actor)
  if (ids !== null && !ids.includes(requestedId)) return null

  return prisma.user.findFirst({
    where: { id: requestedId, isActive: true },
    select: { id: true, name: true },
  })
}
