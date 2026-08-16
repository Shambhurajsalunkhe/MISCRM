import 'server-only'

import { prisma } from '@/lib/db'
import { clientVisibilityFilter, leadVisibilityFilter } from '@/lib/visibility'
import type { CurrentUser } from '@/lib/auth/session'

/**
 * Activities and documents hang off whichever record they belong to — a lead
 * today, a requirement or candidate in Phase 4. Both tables carry one nullable
 * foreign key per parent (docs/01-data-model.md §4).
 *
 * Every write to either has to answer the same question first: may this user
 * touch that parent? Answering it once, here, is what stops a hand-crafted
 * request attaching a note to somebody else's lead — the parent id arrives in a
 * form field, so it is never trustworthy on its own.
 */

export type AttachmentTarget =
  | { kind: 'lead'; id: string }
  | { kind: 'client'; id: string }

export type ResolvedTarget = {
  target: AttachmentTarget
  /** Human name, for the success message and the activity subject line. */
  label: string
  /** Where the change shows up, for `revalidatePath`. */
  path: string
  /** The `where` fragment identifying this parent on Activity and Document. */
  link: { leadId: string } | { clientId: string }
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

  const client = await prisma.client.findFirst({
    where: {
      id: target.id,
      isDeleted: false,
      ...(await clientVisibilityFilter(user)),
    },
    select: { id: true, companyName: true },
  })

  if (!client) return null

  return {
    target,
    label: client.companyName,
    path: `/clients/${client.id}`,
    link: { clientId: client.id },
  }
}

/** Read the parent out of a form payload. Exactly one of the two is expected. */
export function targetFromFormData(formData: FormData): AttachmentTarget | null {
  const leadId = formData.get('leadId')
  if (typeof leadId === 'string' && leadId !== '') {
    return { kind: 'lead', id: leadId }
  }

  const clientId = formData.get('clientId')
  if (typeof clientId === 'string' && clientId !== '') {
    return { kind: 'client', id: clientId }
  }

  return null
}
