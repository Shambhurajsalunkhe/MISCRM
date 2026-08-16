import type { ActivityType } from '@/generated/prisma/enums'

/**
 * The activity types a person may pick from when logging one by hand.
 *
 * `ActivityType` also carries `STAGE_CHANGE`, `ASSIGNMENT`, `PAYMENT` and
 * `DOCUMENT`, which the application writes itself as a side effect of the thing
 * actually happening. Offering those here would let someone type a stage change
 * that never occurred into the same timeline the real ones appear in.
 */
export const MANUAL_ACTIVITY_TYPES = [
  'CALL',
  'EMAIL',
  'MEETING',
  'LINKEDIN_MESSAGE',
  'WHATSAPP',
  'NOTE',
  'PROPOSAL_SENT',
  'FOLLOW_UP',
  'OTHER',
] as const

export type ManualActivityType = (typeof MANUAL_ACTIVITY_TYPES)[number]

/** Labels for every type, including the ones the application writes itself. */
export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  CALL: 'Call',
  EMAIL: 'Email',
  MEETING: 'Meeting',
  LINKEDIN_MESSAGE: 'LinkedIn message',
  WHATSAPP: 'WhatsApp',
  NOTE: 'Note',
  STAGE_CHANGE: 'Stage change',
  ASSIGNMENT: 'Assignment',
  PROPOSAL_SENT: 'Proposal sent',
  DEMO: 'Demo',
  INTERVIEW: 'Interview',
  FOLLOW_UP: 'Follow-up',
  PAYMENT: 'Payment',
  DOCUMENT: 'Document',
  OTHER: 'Other',
}

/** Types the application writes; shown in the timeline but never composable. */
export const SYSTEM_ACTIVITY_TYPES: ActivityType[] = [
  'STAGE_CHANGE',
  'ASSIGNMENT',
  'PAYMENT',
  'DOCUMENT',
]
