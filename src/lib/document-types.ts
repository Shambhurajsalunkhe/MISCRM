import type { DocumentType } from '@/generated/prisma/enums'

/** The typed uploads of README §36, in the order the picker offers them. */
export const DOCUMENT_TYPES: DocumentType[] = [
  'REQUIREMENT_DOC',
  'PROPOSAL',
  'ESTIMATE',
  'QUOTATION',
  'CONTRACT',
  'INVOICE',
  'RESUME',
  'CHAT_TRANSCRIPT',
  'CASE_STUDY',
  'OTHER',
]

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  REQUIREMENT_DOC: 'Requirement document',
  PROPOSAL: 'Proposal',
  ESTIMATE: 'Estimate',
  QUOTATION: 'Quotation',
  CONTRACT: 'Contract',
  INVOICE: 'Invoice',
  RESUME: 'Resume',
  CHAT_TRANSCRIPT: 'Chat transcript',
  CASE_STUDY: 'Case study',
  OTHER: 'Other',
}
