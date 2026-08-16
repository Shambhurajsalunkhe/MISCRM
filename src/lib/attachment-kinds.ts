/**
 * The five records an activity or a document can hang off, and the form field
 * each one travels in.
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
] as const

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]

/** Which `<input name>` carries each parent id. */
export const ATTACHMENT_FIELD: Record<AttachmentKind, string> = {
  lead: 'leadId',
  client: 'clientId',
  requirement: 'requirementId',
  candidate: 'candidateId',
  submission: 'submissionId',
}

/** What the activity and upload forms are handed. */
export type AttachmentParent = { kind: AttachmentKind; id: string }
