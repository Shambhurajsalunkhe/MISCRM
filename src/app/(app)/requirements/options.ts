import 'server-only'

import { prisma } from '@/lib/db'
import { leadVisibilityFilter } from '@/lib/visibility'
import type { CurrentUser } from '@/lib/auth/session'

/**
 * The dropdown contents the requirement form and the requirement list share.
 *
 * Kept out of both pages because the form is rendered twice — new and edit —
 * and a picker that offered active users on one screen and every user on the
 * other would let an edit quietly reassign work to someone who has left.
 */

/** Requirement stages are one global list, unlike pipeline stages. */
export function requirementStageOptions() {
  return prisma.requirementStage.findMany({
    where: { isActive: true },
    select: { id: true, name: true, sortOrder: true, isWon: true, isLost: true },
    orderBy: { sortOrder: 'asc' },
  })
}

export function requirementTypeOptions() {
  return prisma.requirementType.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}

export function activeUserOptions() {
  return prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}

/**
 * Lost reasons available to a staffing requirement.
 *
 * Global reasons plus the ones belonging to the vertical of this requirement's
 * lead — the same rule the lead's own stage control follows, because the
 * reasons are one master list serving both levels.
 */
export function lostReasonOptions(verticalId: string) {
  return prisma.lostReason.findMany({
    where: {
      isActive: true,
      OR: [{ verticalId: null }, { verticalId }],
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}

/**
 * The leads a new requirement can be raised against.
 *
 * Only verticals whose requirements module is on, which is what makes this a
 * short list rather than every lead in the system: the switch is master data,
 * so a vertical that starts taking requirements appears here without a code
 * change (the same reasoning as `src/lib/leads/vertical-form.ts`).
 *
 * Capped, like the lead form's client picker and for the same reason — a
 * typeahead is the real answer, and is worth building once. The usual route in
 * is the lead's own Requirements tab, where no picker is needed at all.
 */
export const LEAD_PICKER_LIMIT = 500

export async function requirementLeadOptions(user: CurrentUser) {
  return prisma.lead.findMany({
    where: {
      isDeleted: false,
      vertical: { usesRequirements: true, isActive: true },
      ...(await leadVisibilityFilter(user)),
    },
    select: {
      id: true,
      leadCode: true,
      title: true,
      assignedToId: true,
      client: { select: { companyName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: LEAD_PICKER_LIMIT,
  })
}
