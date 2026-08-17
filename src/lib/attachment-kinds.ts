/**
 * The records an activity or a document can hang off, and the form field each
 * one travels in.
 *
 * Split out of `src/lib/attachments.ts` because that module is `server-only`
 * and the activity and upload forms are client components. They need the field
 * name to render a hidden input; the server needs it to read the input back.
 * One list, so a new parent cannot be added to one half and forgotten in the
 * other.
 */

export const ATTACHMENT_KINDS = [
  'lead',
  'client',
  'requirement',
  'candidate',
  'submission',
  'quotation',
  'contract',
  'invoice',
] as const

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]

/**
 * The subset `Activity` can actually carry.
 *
 * `Document` has a nullable column for all eight; `Activity` has four. That is
 * the right shape — a signed contract is a file, and what happened around it is
 * a note on the deal, not a second timeline nobody would think to open — but it
 * means the two lists are genuinely different rather than one being an
 * oversight. Naming the difference here is what lets `logActivityAction` refuse
 * a parent it cannot write, instead of handing Prisma an unknown column and
 * returning "something went wrong" to someone who did nothing wrong.
 *
 * (Before this list existed, `submission` was already in the same position: a
 * hand-crafted post naming one would have failed at the database rather than at
 * the door.)
 */
export const ACTIVITY_KINDS = [
  'lead',
  'client',
  'requirement',
  'candidate',
] as const satisfies readonly AttachmentKind[]

export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

export function isActivityKind(kind: AttachmentKind): kind is ActivityKind {
  return (ACTIVITY_KINDS as readonly AttachmentKind[]).includes(kind)
}

/** Which `<input name>` carries each parent id. */
export const ATTACHMENT_FIELD: Record<AttachmentKind, string> = {
  lead: 'leadId',
  client: 'clientId',
  requirement: 'requirementId',
  candidate: 'candidateId',
  submission: 'submissionId',
  quotation: 'quotationId',
  contract: 'contractId',
  invoice: 'invoiceId',
}

/** What the activity and upload forms are handed. */
export type AttachmentParent = { kind: AttachmentKind; id: string }
