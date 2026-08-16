import type { BadgeTone } from '@/components/ui/badge'
import type {
  InterviewResult,
  RequirementStatus,
} from '@/generated/prisma/enums'

/**
 * How staffing records are labelled and coloured, in one place — the same job
 * `src/lib/leads/display.ts` does for leads.
 *
 * The requirement list, the requirement header, the client page and the
 * staffing report all render `RequirementStatus`. Defining the mapping once is
 * what stops PARTIALLY_FILLED being amber on one screen and green on the next.
 */

export const REQUIREMENT_STATUS_LABELS: Record<RequirementStatus, string> = {
  OPEN: 'Open',
  ON_HOLD: 'On hold',
  PARTIALLY_FILLED: 'Partially filled',
  FILLED: 'Filled',
  LOST: 'Lost',
  CANCELLED: 'Cancelled',
}

export const REQUIREMENT_STATUS_TONES: Record<RequirementStatus, BadgeTone> = {
  OPEN: 'info',
  ON_HOLD: 'warning',
  // Partially filled is a win, not a warning: openings were filled, and the
  // requirement is still live for the rest. Colouring it amber would read as a
  // problem on a screen whose whole point is to show progress.
  PARTIALLY_FILLED: 'success',
  FILLED: 'success',
  LOST: 'danger',
  CANCELLED: 'neutral',
}

/** Filter order: live work first, outcomes after. */
export const REQUIREMENT_STATUS_ORDER: RequirementStatus[] = [
  'OPEN',
  'ON_HOLD',
  'PARTIALLY_FILLED',
  'FILLED',
  'LOST',
  'CANCELLED',
]

/**
 * The statuses that mean "nobody is working this any more".
 *
 * Used by the default list filter and by the lead-outcome derivation, which
 * only recomputes once every requirement has stopped moving.
 */
export const REQUIREMENT_CLOSED_STATUSES: RequirementStatus[] = [
  'FILLED',
  'LOST',
  'CANCELLED',
]

export const INTERVIEW_RESULT_LABELS: Record<InterviewResult, string> = {
  PENDING: 'Pending',
  SELECTED: 'Selected',
  REJECTED: 'Rejected',
  ON_HOLD: 'On hold',
  NO_SHOW: 'No show',
}

export const INTERVIEW_RESULT_TONES: Record<InterviewResult, BadgeTone> = {
  PENDING: 'neutral',
  SELECTED: 'success',
  REJECTED: 'danger',
  ON_HOLD: 'warning',
  NO_SHOW: 'warning',
}

export const INTERVIEW_RESULTS: InterviewResult[] = [
  'PENDING',
  'SELECTED',
  'REJECTED',
  'ON_HOLD',
  'NO_SHOW',
]

/** Onsite / Remote / Hybrid — a free-text column with three real answers. */
export const WORK_MODES = ['Onsite', 'Remote', 'Hybrid'] as const

/** Where a candidate came from. Free text on the model; these are the suggestions. */
export const CANDIDATE_SOURCE_CHANNELS = [
  'Naukri',
  'LinkedIn',
  'Referral',
  'Internal bench',
  'Job board',
  'Direct application',
  'Vendor',
] as const

/** Telephonic / Video / F2F, same idea as `WORK_MODES`. */
export const INTERVIEW_MODES = ['Telephonic', 'Video', 'Face to face'] as const

/**
 * "2 of 5 filled" — the phrase that appears on every requirement row.
 *
 * Openings and positions filled are two numbers that mean nothing apart, and
 * writing them out separately in six places is how they end up transposed in
 * one of them.
 */
export function fillLabel(openings: number, positionsFilled: number): string {
  return `${positionsFilled} of ${openings} filled`
}
