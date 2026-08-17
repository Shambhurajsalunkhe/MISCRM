import 'server-only'

import { prisma } from '@/lib/db'
import { can } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import {
  clientVisibilityFilter,
  leadChildVisibilityFilter,
  leadVisibilityFilter,
  requirementVisibilityFilter,
} from '@/lib/visibility'
import {
  ATTACHMENT_FIELD,
  ATTACHMENT_KINDS,
  type AttachmentKind,
} from '@/lib/attachment-kinds'
import type { CurrentUser } from '@/lib/auth/session'

/**
 * Activities and documents hang off whichever record they belong to — a lead, a
 * client, a requirement, a candidate, or (documents only) a submission. Both
 * tables carry one nullable foreign key per parent
 * (docs/01-data-model.md §4).
 *
 * Every write to either has to answer the same question first: may this user
 * touch that parent? Answering it once, here, is what stops a hand-crafted
 * request attaching a note to somebody else's lead — the parent id arrives in a
 * form field, so it is never trustworthy on its own.
 *
 * **Candidates are the one target with no row scope**, and that is deliberate.
 * Decision D9 makes the candidate master shared so that one person submitted to
 * three clients stays one candidate; a master where a recruiter cannot see the
 * profile a colleague sourced is a master that produces the duplicate rows it
 * exists to prevent. What a candidate row does *not* carry is any client's
 * information — that lives on the submission, which is scoped through its
 * requirement like everything else here.
 *
 * Because a candidate has no row scope, **the staffing permission is its only
 * gate, and it is checked here** rather than left to the caller. Both callers
 * hold `activity.manage`, which is a different capability: without this, an
 * administrator who revoked someone's `staffing.candidate.manage` would still
 * leave them able to attach files to any candidate and — through
 * `/api/documents/[id]`, which resolves the same targets — download every
 * resume in the master.
 */

export type AttachmentTarget = { kind: AttachmentKind; id: string }

export type ResolvedTarget = {
  target: AttachmentTarget
  /** Human name, for the success message and the activity subject line. */
  label: string
  /** Where the change shows up, for `revalidatePath`. */
  path: string
  /** The `where` fragment identifying this parent on Activity and Document. */
  link:
    | { leadId: string }
    | { clientId: string }
    | { requirementId: string }
    | { candidateId: string }
    | { submissionId: string }
    | { quotationId: string }
    | { contractId: string }
    | { invoiceId: string }
}

/**
 * Resolve a form-supplied parent to something safe to write against, or `null`
 * if this user cannot see it.
 *
 * Note it returns `null` for "not visible" as well as "does not exist". Telling
 * the two apart would confirm the existence of a lead the user may not see,
 * which is the thing visibility rules are for.
 */
export async function resolveTarget(
  user: CurrentUser,
  target: AttachmentTarget,
): Promise<ResolvedTarget | null> {
  if (target.kind === 'lead') {
    const lead = await prisma.lead.findFirst({
      where: {
        id: target.id,
        isDeleted: false,
        ...(await leadVisibilityFilter(user)),
      },
      select: { id: true, leadCode: true },
    })

    if (!lead) return null

    return {
      target,
      label: lead.leadCode,
      path: `/leads/${lead.id}`,
      link: { leadId: lead.id },
    }
  }

  if (target.kind === 'client') {
    const client = await prisma.client.findFirst({
      where: {
        id: target.id,
        isDeleted: false,
        ...(await clientVisibilityFilter(user)),
      },
      select: { id: true, clientName: true },
    })

    if (!client) return null

    return {
      target,
      label: client.clientName,
      path: `/clients/${client.id}`,
      link: { clientId: client.id },
    }
  }

  if (target.kind === 'requirement') {
    if (!(await can(user, PERMISSIONS.STAFFING_REQUIREMENT_MANAGE))) return null

    const requirement = await prisma.requirement.findFirst({
      where: {
        id: target.id,
        isDeleted: false,
        ...(await requirementVisibilityFilter(user)),
      },
      select: { id: true, requirementCode: true },
    })

    if (!requirement) return null

    return {
      target,
      label: requirement.requirementCode,
      path: `/requirements/${requirement.id}`,
      link: { requirementId: requirement.id },
    }
  }

  if (target.kind === 'submission') {
    if (!(await can(user, PERMISSIONS.STAFFING_CANDIDATE_MANAGE))) return null

    // Scoped through the requirement, not the candidate: a submission is the
    // one staffing record that names a client's interest in a person, so it
    // inherits the requirement's scope rather than the master's openness.
    const submission = await prisma.candidateSubmission.findFirst({
      where: {
        id: target.id,
        requirement: {
          isDeleted: false,
          ...(await requirementVisibilityFilter(user)),
        },
      },
      select: {
        id: true,
        requirementId: true,
        candidate: { select: { fullName: true } },
        requirement: { select: { requirementCode: true } },
      },
    })

    if (!submission) return null

    return {
      target,
      label: `${submission.candidate.fullName} on ${submission.requirement.requirementCode}`,
      path: `/requirements/${submission.requirementId}/submissions/${submission.id}`,
      link: { submissionId: submission.id },
    }
  }

  // The three commercial documents. Each is scoped through its lead — none of
  // them carries an owner, and an invoice belongs to the deal that produced it
  // rather than to whoever raised it (see `leadChildVisibilityFilter`).
  //
  // `commercial.manage` gates them for the same reason the staffing permission
  // gates candidates: without it, an administrator who took the capability away
  // would still leave that person able to attach files to any quotation and —
  // through /api/documents/[id], which resolves the same targets — download
  // every signed contract in the company.
  if (
    target.kind === 'quotation' ||
    target.kind === 'contract' ||
    target.kind === 'invoice'
  ) {
    if (!(await can(user, PERMISSIONS.COMMERCIAL_MANAGE))) return null

    const scope = await leadChildVisibilityFilter(user)

    if (target.kind === 'quotation') {
      const quotation = await prisma.quotation.findFirst({
        where: { id: target.id, ...scope },
        select: { id: true, quoteNumber: true },
      })

      if (!quotation) return null

      return {
        target,
        label: quotation.quoteNumber,
        path: `/quotations/${quotation.id}`,
        link: { quotationId: quotation.id },
      }
    }

    if (target.kind === 'contract') {
      const contract = await prisma.contract.findFirst({
        where: { id: target.id, ...scope },
        select: { id: true, contractNumber: true },
      })

      if (!contract) return null

      return {
        target,
        label: contract.contractNumber,
        path: `/contracts/${contract.id}`,
        link: { contractId: contract.id },
      }
    }

    const invoice = await prisma.invoice.findFirst({
      where: { id: target.id, ...scope },
      select: { id: true, invoiceNumber: true },
    })

    if (!invoice) return null

    return {
      target,
      label: invoice.invoiceNumber,
      path: `/invoices/${invoice.id}`,
      link: { invoiceId: invoice.id },
    }
  }

  // Candidate — see the module comment. The permission is the whole gate here,
  // because there is no row scope behind it.
  if (!(await can(user, PERMISSIONS.STAFFING_CANDIDATE_MANAGE))) return null

  const candidate = await prisma.candidate.findFirst({
    where: { id: target.id, isDeleted: false },
    select: { id: true, fullName: true },
  })

  if (!candidate) return null

  return {
    target,
    label: candidate.fullName,
    path: `/candidates/${candidate.id}`,
    link: { candidateId: candidate.id },
  }
}

/** Read the parent out of a form payload. Exactly one field is expected. */
export function targetFromFormData(formData: FormData): AttachmentTarget | null {
  for (const kind of ATTACHMENT_KINDS) {
    const value = formData.get(ATTACHMENT_FIELD[kind])
    if (typeof value === 'string' && value !== '') return { kind, id: value }
  }

  return null
}

/**
 * The parent an existing `Activity` or `Document` row hangs off.
 *
 * The two delete actions each read a row, work out which of its nullable
 * parents is set, and re-resolve it. Doing that from the column names in one
 * place is what keeps a new parent from being added to the schema and silently
 * missed by a delete path — which would report "attached to a record you cannot
 * see" for a record the user owns.
 */
export function targetFromRow(row: {
  leadId?: string | null
  clientId?: string | null
  requirementId?: string | null
  candidateId?: string | null
  submissionId?: string | null
  quotationId?: string | null
  contractId?: string | null
  invoiceId?: string | null
}): AttachmentTarget | null {
  // The commercial parents are read first. A document attached to an invoice
  // carries no `leadId` of its own, but if one is ever set as well, the invoice
  // is the more specific answer and the page the user came from.
  if (row.quotationId) return { kind: 'quotation', id: row.quotationId }
  if (row.contractId) return { kind: 'contract', id: row.contractId }
  if (row.invoiceId) return { kind: 'invoice', id: row.invoiceId }
  if (row.submissionId) return { kind: 'submission', id: row.submissionId }
  if (row.requirementId) return { kind: 'requirement', id: row.requirementId }
  if (row.candidateId) return { kind: 'candidate', id: row.candidateId }
  if (row.leadId) return { kind: 'lead', id: row.leadId }
  if (row.clientId) return { kind: 'client', id: row.clientId }
  return null
}
