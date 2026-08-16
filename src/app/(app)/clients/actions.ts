'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { auditedTransaction, prisma, type TransactionClient } from '@/lib/db'
import { withAudit } from '@/lib/action'
import { nextClientCode } from '@/lib/codes'
import { PERMISSIONS } from '@/lib/permissions'
import {
  buildDedupeKey,
  emailDomain,
  findClientDuplicates,
  findContactDuplicates,
  normaliseUrl,
  recordDuplicateOverride,
} from '@/lib/dedupe'
import {
  optionalEmail,
  optionalId,
  optionalText,
  optionalUrl,
} from '@/lib/form-fields'
import { clientVisibilityFilter } from '@/lib/visibility'
import {
  actionError,
  actionSuccess,
  actionWarning,
  checkboxValue,
  formValues,
  fromZodError,
  optionalString,
  type ActionState,
} from '@/lib/form'
import type { CurrentUser } from '@/lib/auth/session'

const clientSchema = z.object({
  companyName: z.string().trim().min(2, 'Enter the company name.').max(200),
  website: optionalUrl(300),
  companyLinkedIn: optionalUrl(300),
  industry: optionalText(120),
  countryId: optionalId,
  city: optionalText(120),
  address: optionalText(500),
  ownerId: optionalId,
})

/** The optional first contact captured alongside a new client. */
const primaryContactSchema = z.object({
  contactName: optionalText(120),
  contactDesignation: optionalText(120),
  contactEmail: optionalEmail,
  contactPhone: optionalText(60),
  contactLinkedIn: optionalUrl(300),
})

const contactSchema = z.object({
  name: z.string().trim().min(2, 'Enter the contact’s name.').max(120),
  designation: optionalText(120),
  email: optionalEmail,
  phone: optionalText(60),
  linkedInProfile: optionalUrl(300),
})

/**
 * Postgres unique-violation. Surfaced as a readable message rather than a 500:
 * `dedupeKey` is the one constraint a user can hit by doing something
 * reasonable, and "that company already exists" is the answer they need.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  )
}

/**
 * Recompute a client's `dedupeKey` from its current name and primary contact.
 *
 * Called after any write that could change either half. Keeping it derived
 * rather than typed means the constraint keeps meaning what it says even after
 * a company is renamed or its first contact's address changes — a key left
 * stale would stop catching the duplicate it exists to catch.
 */
async function refreshDedupeKey(
  tx: TransactionClient,
  clientId: string,
): Promise<void> {
  const client = await tx.client.findUnique({
    where: { id: clientId },
    select: {
      companyName: true,
      website: true,
      contacts: {
        where: { isActive: true, email: { not: null } },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        take: 1,
        select: { email: true },
      },
    },
  })

  if (!client) return

  // Contact address first, falling back to the website host: a company with no
  // contact yet still gets a distinguishing key, so two unrelated companies
  // with the same name can both be saved.
  const domain =
    emailDomain(client.contacts[0]?.email) ??
    normaliseUrl(client.website)?.split('/')[0] ??
    null

  await tx.client.update({
    where: { id: clientId },
    data: { dedupeKey: buildDedupeKey(client.companyName, domain) },
  })
}

/** A client the signed-in user is allowed to open. */
async function visibleClient(user: CurrentUser, id: string) {
  return prisma.client.findFirst({
    where: { id, isDeleted: false, ...(await clientVisibilityFilter(user)) },
    select: { id: true, companyName: true },
  })
}

export async function createClientAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let createdId: string | null = null

  const result = await withAudit(PERMISSIONS.LEAD_EDIT, async (actor) => {
    const values = formValues(formData)
    const parsed = clientSchema.merge(primaryContactSchema).safeParse(values)
    if (!parsed.success) return fromZodError(parsed.error)

    const data = parsed.data
    const overrideReason = optionalString(formData.get('overrideReason'))

    const duplicates = await findClientDuplicates({
      companyName: data.companyName,
      website: data.website,
      companyLinkedIn: data.companyLinkedIn,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone,
    })

    // First submit stops here and shows what it found; a second submit carrying
    // a reason goes through. Never a hard block — a second genuine enquiry from
    // a company we already know is the normal case, not the exception.
    if (duplicates.length > 0 && !overrideReason) {
      return actionWarning(
        'This looks like a company we already have. Check the matches, then give a reason to save it anyway.',
        duplicates,
      )
    }

    const {
      contactName,
      contactDesignation,
      contactEmail,
      contactPhone,
      contactLinkedIn,
      ...company
    } = data

    const domain =
      emailDomain(contactEmail) ?? normaliseUrl(company.website)?.split('/')[0] ?? null

    try {
      const client = await auditedTransaction(async (tx) => {
        const created = await tx.client.create({
          data: {
            ...company,
            clientCode: await nextClientCode(tx),
            dedupeKey: buildDedupeKey(company.companyName, domain),
          },
          select: { id: true, companyName: true, clientCode: true },
        })

        if (contactName) {
          await tx.clientContact.create({
            data: {
              clientId: created.id,
              name: contactName,
              designation: contactDesignation,
              email: contactEmail,
              phone: contactPhone,
              linkedInProfile: contactLinkedIn,
              isPrimary: true,
            },
          })
        }

        return created
      })

      if (overrideReason) {
        await recordDuplicateOverride({
          entityType: 'CLIENT',
          entityId: client.id,
          reason: overrideReason,
          warnings: duplicates,
          userId: actor.id,
        })
      }

      createdId = client.id
      revalidatePath('/clients')
      return actionSuccess(`${client.companyName} added as ${client.clientCode}.`)
    } catch (error) {
      if (isUniqueViolation(error)) {
        return actionError(
          'A client with this company name and email domain already exists. Open it and add the new enquiry there as a lead.',
          { companyName: 'This company is already on file.' },
        )
      }
      throw error
    }
  })

  // Redirect outside the action wrapper: `redirect` throws, and throwing inside
  // the transaction body would roll the client back after it was created.
  if (result.status === 'success' && createdId) redirect(`/clients/${createdId}`)

  return result
}

export async function updateClientAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.LEAD_EDIT, async (actor) => {
    const id = formData.get('id')
    if (typeof id !== 'string' || id === '') return actionError('Missing client id.')

    const parsed = clientSchema.safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const data = parsed.data
    const overrideReason = optionalString(formData.get('overrideReason'))

    const existing = await visibleClient(actor, id)
    if (!existing) return actionError('That client no longer exists.')

    const duplicates = await findClientDuplicates({
      companyName: data.companyName,
      website: data.website,
      companyLinkedIn: data.companyLinkedIn,
      excludeClientId: id,
    })

    if (duplicates.length > 0 && !overrideReason) {
      return actionWarning(
        'These changes make this client look like one we already have.',
        duplicates,
      )
    }

    try {
      await auditedTransaction(async (tx) => {
        await tx.client.update({
          where: { id },
          data: { ...data, isActive: checkboxValue(formData, 'isActive') },
        })
        await refreshDedupeKey(tx, id)
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        return actionError(
          'Another client already has this company name and email domain.',
          { companyName: 'This company is already on file.' },
        )
      }
      throw error
    }

    if (overrideReason) {
      await recordDuplicateOverride({
        entityType: 'CLIENT',
        entityId: id,
        reason: overrideReason,
        warnings: duplicates,
        userId: actor.id,
      })
    }

    revalidatePath('/clients')
    revalidatePath(`/clients/${id}`)
    return actionSuccess('Changes saved.')
  })
}

export async function saveContactAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.LEAD_EDIT, async (actor) => {
    const clientId = formData.get('clientId')
    if (typeof clientId !== 'string' || clientId === '') {
      return actionError('Missing client id.')
    }

    const id = optionalString(formData.get('id'))
    const parsed = contactSchema.safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const data = parsed.data
    const overrideReason = optionalString(formData.get('overrideReason'))

    const client = await visibleClient(actor, clientId)
    if (!client) return actionError('That client no longer exists.')

    // Matches within this same client are not duplicates worth reporting —
    // that is one person with two records on the account, which the person
    // looking at the contacts list can already see.
    const duplicates = await findContactDuplicates({
      email: data.email,
      phone: data.phone,
      excludeContactId: id,
      excludeClientId: clientId,
    })

    if (duplicates.length > 0 && !overrideReason) {
      return actionWarning(
        'This contact’s details already appear against another company.',
        duplicates,
      )
    }

    const isPrimary = checkboxValue(formData, 'isPrimary')

    const savedId = await auditedTransaction(async (tx) => {
      // One primary per client. Demoting the others first rather than after,
      // so a failure part-way through cannot leave the client with none.
      if (isPrimary) {
        await tx.clientContact.updateMany({
          where: { clientId, isPrimary: true, ...(id ? { id: { not: id } } : {}) },
          data: { isPrimary: false },
        })
      }

      if (id) {
        await tx.clientContact.update({
          where: { id },
          data: {
            ...data,
            isPrimary,
            isActive: checkboxValue(formData, 'isActive'),
          },
        })
        await refreshDedupeKey(tx, clientId)
        return id
      }

      const created = await tx.clientContact.create({
        data: { ...data, clientId, isPrimary },
        select: { id: true },
      })

      await refreshDedupeKey(tx, clientId)
      return created.id
    })

    // Previously guarded on `id`, which meant a *new* contact saved past a
    // duplicate warning recorded nothing — the one case where knowing why
    // someone created a second record matters most. The id now comes back from
    // the transaction, so both paths are audited.
    if (overrideReason) {
      await recordDuplicateOverride({
        entityType: 'CONTACT',
        entityId: savedId,
        reason: overrideReason,
        warnings: duplicates,
        userId: actor.id,
      })
    }

    revalidatePath(`/clients/${clientId}`)
    return actionSuccess(id ? 'Contact updated.' : `${data.name} added.`)
  })
}

export async function setContactActiveAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.LEAD_EDIT, async (actor) => {
    const id = formData.get('id')
    const isActive = formData.get('isActive') === 'true'
    if (typeof id !== 'string' || id === '') return actionError('Missing contact id.')

    const contact = await prisma.clientContact.findUnique({
      where: { id },
      select: { clientId: true, name: true, isPrimary: true },
    })
    if (!contact) return actionError('That contact no longer exists.')

    if (!(await visibleClient(actor, contact.clientId))) {
      return actionError('That client no longer exists.')
    }

    // A deactivated primary contact would still be the one every lead form
    // pre-selects, so the flag comes off with the activation.
    //
    // Transactional and followed by `refreshDedupeKey`, because the key is
    // derived from the *active* primary contact's email domain — deactivating
    // them silently changes which address the company is identified by, and a
    // stale key stops catching the duplicates it exists to catch.
    await auditedTransaction(async (tx) => {
      await tx.clientContact.update({
        where: { id },
        data: { isActive, ...(isActive ? {} : { isPrimary: false }) },
      })
      await refreshDedupeKey(tx, contact.clientId)
    })

    revalidatePath(`/clients/${contact.clientId}`)
    return actionSuccess(
      isActive ? `${contact.name} reactivated.` : `${contact.name} deactivated.`,
    )
  })
}

/**
 * Soft delete (open question Q10). The row stays, so every lead it holds keeps
 * its client and the revenue reports still add up; the client simply stops
 * appearing in lists and in the lead form's picker.
 */
export async function deleteClientAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.LEAD_DELETE, async (actor) => {
    const id = formData.get('id')
    if (typeof id !== 'string' || id === '') return actionError('Missing client id.')

    const client = await visibleClient(actor, id)
    if (!client) return actionError('That client no longer exists.')

    const openLeads = await prisma.lead.count({
      where: { clientId: id, isDeleted: false, status: 'OPEN' },
    })

    if (openLeads > 0) {
      return actionError(
        `${client.companyName} has ${openLeads} open lead(s). Close or delete those first — deleting the client would hide leads people are still working.`,
      )
    }

    await prisma.client.update({
      where: { id },
      data: { isDeleted: true, isActive: false },
    })

    revalidatePath('/clients')
    return actionSuccess(`${client.companyName} deleted. An administrator can restore it.`)
  })
}
