import 'server-only'

import { cache } from 'react'
import { notFound } from 'next/navigation'

import { prisma } from '@/lib/db'
import { leadVisibilityFilter } from '@/lib/visibility'
import type { CurrentUser } from '@/lib/auth/session'

/**
 * The lead behind every tab of the detail screen.
 *
 * Each tab is its own server component fetching only its own rows, but all four
 * share the header — so this runs once per request thanks to `cache()`, not
 * once per tab plus once for the layout.
 *
 * `notFound()` rather than a "forbidden" page: a lead outside this user's scope
 * must be indistinguishable from one that does not exist, or the 403 itself
 * tells them a lead with that id is out there.
 */
export const loadLead = cache(async (user: CurrentUser, id: string) => {
  const lead = await prisma.lead.findFirst({
    where: { id, isDeleted: false, ...(await leadVisibilityFilter(user)) },
    select: {
      id: true,
      leadCode: true,
      title: true,
      requirementDescription: true,
      status: true,
      commonStage: true,
      priority: true,
      expectedBudget: true,
      dealValue: true,
      expectedTimeline: true,
      additionalNotes: true,
      campaignName: true,
      referenceUrl: true,
      stageChangedAt: true,
      nextFollowUpAt: true,
      expectedCloseDate: true,
      closedAt: true,
      lostNotes: true,
      createdAt: true,
      currentStageId: true,
      primaryContactId: true,
      serviceId: true,
      productId: true,
      sourceId: true,
      client: {
        select: { id: true, clientCode: true, companyName: true, country: { select: { name: true } } },
      },
      primaryContact: {
        select: { id: true, name: true, designation: true, email: true, phone: true },
      },
      vertical: {
        select: {
          id: true,
          code: true,
          name: true,
          colorHex: true,
          usesRequirements: true,
          usesCandidates: true,
          usesDemos: true,
          usesQuotations: true,
          usesContracts: true,
          usesInvoicing: true,
        },
      },
      currentStage: {
        select: { id: true, name: true, sortOrder: true, isWon: true, isLost: true },
      },
      source: { select: { name: true } },
      // The counter batch this lead answered (decision D1). Shown on Overview
      // so the pitch-to-response rate can be checked against a specific day's
      // work rather than only in aggregate.
      sourceActivity: {
        select: {
          id: true,
          activityDate: true,
          count: true,
          metric: { select: { label: true } },
          user: { select: { name: true } },
        },
      },
      service: { select: { name: true } },
      product: { select: { name: true } },
      lostReason: { select: { name: true } },
      generatedBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      team: { select: { name: true } },
      createdBy: { select: { name: true } },
      _count: {
        select: {
          activities: true,
          documents: true,
          stageHistory: true,
          // Unfiltered by visibility on purpose: this is the tab's badge, and a
          // count that shrank because one role belongs to another recruiter
          // would read as requirements having been deleted. The tab itself
          // re-queries through the scope and says how many it is not showing.
          requirements: true,
        },
      },
    },
  })

  if (!lead) notFound()

  return lead
})

export type LeadDetail = Awaited<ReturnType<typeof loadLead>>
