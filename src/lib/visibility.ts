import 'server-only'

import { cache } from 'react'

import { prisma } from '@/lib/db'
import type { CurrentUser } from '@/lib/auth/session'

/**
 * Data scope (decision D7, docs/01-data-model.md §5).
 *
 *   ADMIN / SALES_HEAD  -> everything
 *   MANAGER / BDM       -> self + everyone in their reporting sub-tree
 *   BDE                 -> self only
 *
 * Returning `null` means "no restriction". Callers must treat `null` and
 * `[]` differently — an empty array means the user can see nothing.
 */
export const visibleUserIds = cache(
  async (user: CurrentUser): Promise<string[] | null> => {
    if (user.role === 'ADMIN' || user.role === 'SALES_HEAD') {
      return null
    }

    if (user.role === 'BDE') {
      return [user.id]
    }

    // MANAGER / BDM: walk the reporting chain downwards, plus anyone in a team
    // they manage. Depth is bounded to stop a mis-configured cycle from
    // spinning; org charts are never 20 levels deep.
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      WITH RECURSIVE subtree(id, depth) AS (
        SELECT "id", 0 FROM "User" WHERE "id" = ${user.id}
        UNION
        SELECT u."id", s.depth + 1
        FROM "User" u
        JOIN subtree s ON u."reportingManagerId" = s.id
        WHERE s.depth < 20
      )
      SELECT id FROM subtree
      UNION
      SELECT u."id"
      FROM "User" u
      JOIN "Team" t ON u."teamId" = t."id"
      WHERE t."managerId" = ${user.id}
    `

    return rows.map((row) => row.id)
  },
)

/**
 * A Prisma `where` fragment restricting leads to those the user may see.
 * A lead is visible if the user generated it *or* it is assigned to them —
 * README §6.3 keeps those two roles distinct, and both confer visibility.
 */
export async function leadVisibilityFilter(user: CurrentUser) {
  const ids = await visibleUserIds(user)
  if (ids === null) return {}

  return {
    OR: [{ generatedById: { in: ids } }, { assignedToId: { in: ids } }],
  }
}

/**
 * Clients a user may see.
 *
 * Wider than the lead filter on purpose: a client is visible to its owner *and*
 * to anyone who can see one of its leads. A BDE who sourced `UP-0042` needs the
 * account page to add the contact they just spoke to, and would otherwise be
 * able to open the lead but not the company it belongs to.
 *
 * A client with no leads and no owner is visible only to Sales Head and Admin.
 * That is the right default — an account nobody works and nobody owns is not
 * anyone's to see — and it is fixed by setting an owner.
 */
export async function clientVisibilityFilter(user: CurrentUser) {
  const ids = await visibleUserIds(user)
  if (ids === null) return {}

  return {
    OR: [
      { ownerId: { in: ids } },
      { leads: { some: { generatedById: { in: ids } } } },
      { leads: { some: { assignedToId: { in: ids } } } },
    ],
  }
}

/**
 * Demos, quotations, contracts and invoices, all scoped through their lead.
 *
 * None of the four carries an owner of its own, and none should: an invoice is
 * not worked by anybody, it belongs to the deal that produced it. Deriving the
 * scope from the lead means a handover moves the commercial records with it,
 * and there is no second place for a visibility rule to be wrong.
 *
 * `isDeleted` is folded in here rather than left to the caller. A soft-deleted
 * lead's invoices are not a separate question from the lead — every one of
 * these lists would otherwise need to remember it, and the one that forgot
 * would be showing rows from a deal nobody can open.
 */
export async function leadChildVisibilityFilter(user: CurrentUser) {
  const ids = await visibleUserIds(user)

  if (ids === null) return { lead: { isDeleted: false } }

  return {
    lead: {
      isDeleted: false,
      OR: [{ generatedById: { in: ids } }, { assignedToId: { in: ids } }],
    },
  }
}

/** Same idea for staffing requirements, which are owned by a recruiter/BDM. */
export async function requirementVisibilityFilter(user: CurrentUser) {
  const ids = await visibleUserIds(user)
  if (ids === null) return {}

  return {
    OR: [
      { assignedToId: { in: ids } },
      { lead: { generatedById: { in: ids } } },
      { lead: { assignedToId: { in: ids } } },
    ],
  }
}
