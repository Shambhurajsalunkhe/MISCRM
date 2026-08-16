import 'server-only'

import { cache } from 'react'
import { notFound } from 'next/navigation'

import { prisma } from '@/lib/db'
import { requirementVisibilityFilter } from '@/lib/visibility'
import type { CurrentUser } from '@/lib/auth/session'

/**
 * The requirement behind every tab of the detail screen.
 *
 * Same arrangement as `src/app/(app)/leads/[id]/lead.ts`: each tab fetches only
 * its own rows, and all of them share the header, so this runs once per request
 * thanks to `cache()` rather than once per tab plus once for the layout.
 *
 * `notFound()` rather than a "forbidden" page, for the reason that matters more
 * here than anywhere else in the app: a requirement names a client and a role,
 * so a 403 would tell someone outside its scope that a named company is hiring.
 */
export const loadRequirement = cache(
  async (user: CurrentUser, id: string) => {
    const requirement = await prisma.requirement.findFirst({
      where: {
        id,
        isDeleted: false,
        ...(await requirementVisibilityFilter(user)),
      },
      select: {
        id: true,
        requirementCode: true,
        position: true,
        openings: true,
        positionsFilled: true,
        skills: true,
        minExperience: true,
        maxExperience: true,
        location: true,
        workMode: true,
        budgetMin: true,
        budgetMax: true,
        targetDate: true,
        priority: true,
        description: true,
        status: true,
        currentStageId: true,
        stageChangedAt: true,
        closedAt: true,
        createdAt: true,
        requirementTypeId: true,
        assignedToId: true,
        client: {
          select: { id: true, clientCode: true, companyName: true },
        },
        lead: {
          select: {
            id: true,
            leadCode: true,
            title: true,
            verticalId: true,
            vertical: { select: { name: true } },
          },
        },
        requirementType: { select: { name: true } },
        currentStage: {
          select: {
            id: true,
            name: true,
            sortOrder: true,
            isWon: true,
            isLost: true,
            agingThresholdDays: true,
          },
        },
        lostReason: { select: { name: true } },
        assignedTo: { select: { id: true, name: true } },
        // `createdById` has no relation on `Requirement` in the schema, so the
        // creator is not selectable here. The first row of the History tab
        // names them — it is the "Requirement received" transition, and its
        // `changedById` is the same person.
        createdById: true,
        _count: {
          select: {
            submissions: true,
            activities: true,
            documents: true,
            placements: true,
          },
        },
      },
    })

    if (!requirement) notFound()

    return requirement
  },
)

export type RequirementDetail = Awaited<ReturnType<typeof loadRequirement>>
