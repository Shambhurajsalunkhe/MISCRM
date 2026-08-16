import type { BadgeTone } from '@/components/ui/badge'
import type { CommonStage, LeadStatus, Priority } from '@/generated/prisma/enums'

/**
 * How leads are labelled and coloured, in one place.
 *
 * The lead list, the client page, the detail header and the exports all render
 * the same six enums. Defining the mapping once is what stops WON being green
 * on one screen and grey on the next.
 */

export const LEAD_STATUS_TONES: Record<LeadStatus, BadgeTone> = {
  OPEN: 'info',
  WON: 'success',
  LOST: 'danger',
}

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  OPEN: 'Open',
  WON: 'Won',
  LOST: 'Lost',
}

/**
 * The shared pipeline buckets, in funnel order (README §8).
 *
 * The order matters: the pipeline chart and the stage filter both read as a
 * funnel only if the buckets run from first contact to outcome.
 */
export const COMMON_STAGE_ORDER: CommonStage[] = [
  'NEW',
  'CONTACTED',
  'REQUIREMENT_GATHERING',
  'PROPOSAL',
  'NEGOTIATION',
  'WON',
  'LOST',
]

export const COMMON_STAGE_LABELS: Record<CommonStage, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  REQUIREMENT_GATHERING: 'Requirement gathering',
  PROPOSAL: 'Proposal',
  NEGOTIATION: 'Negotiation',
  WON: 'Won',
  LOST: 'Lost',
}

export const PRIORITY_ORDER: Priority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW']

export const PRIORITY_LABELS: Record<Priority, string> = {
  URGENT: 'Urgent',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
}

export const PRIORITY_TONES: Record<Priority, BadgeTone> = {
  URGENT: 'danger',
  HIGH: 'warning',
  MEDIUM: 'neutral',
  LOW: 'neutral',
}
