/**
 * The shared pipeline layer every vertical stage maps onto (decision D5).
 *
 * Kept in its own module rather than beside the form: a value exported from a
 * `'use client'` file reaches a server component as a client reference, not as
 * the array itself, so importing this list from the form component would give
 * the stages page something it cannot iterate.
 */
export const COMMON_STAGE_OPTIONS = [
  { value: 'NEW', label: 'New' },
  { value: 'CONTACTED', label: 'Contacted' },
  { value: 'REQUIREMENT_GATHERING', label: 'Requirement gathering' },
  { value: 'PROPOSAL', label: 'Proposal' },
  { value: 'NEGOTIATION', label: 'Negotiation' },
  { value: 'WON', label: 'Won' },
  { value: 'LOST', label: 'Lost' },
] as const

export const COMMON_STAGE_LABELS: Record<string, string> = Object.fromEntries(
  COMMON_STAGE_OPTIONS.map((option) => [option.value, option.label]),
)
