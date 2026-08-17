'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { auditedTransaction, prisma } from '@/lib/db'
import { withAudit } from '@/lib/action'
import { can } from '@/lib/authz'
import { nextClientCode, nextLeadCode } from '@/lib/codes'
import {
  buildDedupeKey,
  contactPhoneFields,
  emailDomain,
  findClientDuplicates,
  recordDuplicateOverride,
} from '@/lib/dedupe'
import { assignLead, recordAssignment } from '@/lib/leads/assignment'
import { changeLeadStage } from '@/lib/leads/stage'
import { setInitialStage } from '@/lib/leads/stage'
import { PERMISSIONS } from '@/lib/permissions'
import { isValidSourceActivity } from '@/lib/prospecting/source-link'
import { clientVisibilityFilter, leadVisibilityFilter } from '@/lib/visibility'
import {
  optionalDate,
  optionalId,
  optionalMoney,
  optionalText,
  optionalUrl,
} from '@/lib/form-fields'
import {
  actionError,
  actionSuccess,
  actionWarning,
  formValues,
  fromZodError,
  optionalString,
  type ActionState,
} from '@/lib/form'
import type { CurrentUser } from '@/lib/auth/session'

/**
 * These come from `@/lib/form-fields` rather than being defined here because
 * this form is the reason they exist: it renders a product picker *or* a
 * service picker, and the campaign field only for Digital Marketing, so those
 * keys are simply absent from the payload rather than blank. See that module
 * for what went wrong when the schemas rejected `undefined`.
 */
const leadSchema = z.object({
  verticalId: z.string().trim().min(1, 'Choose a vertical.'),
  title: z.string().trim().min(3, 'Summarise the requirement.').max(200),
  requirementDescription: optionalText(4000),
  sourceId: optionalId,
  serviceId: optionalId,
  productId: optionalId,
  expectedBudget: optionalMoney,
  expectedTimeline: optionalText(120),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  additionalNotes: optionalText(4000),
  campaignName: optionalText(200),
  referenceUrl: optionalUrl(500),
  expectedCloseDate: optionalDate,
  nextFollowUpAt: optionalDate,
  generatedById: optionalId,
  assignedToId: optionalId,
  /** The counter batch this lead answered — set on create only (decision D1). */
  sourceActivityId: optionalId,
})

/** Creating a lead against a client that is not on file yet. */
const newClientSchema = z.object({
  clientName: z.string().trim().min(2, 'Enter the client name.').max(200),
  companyName: optionalText(200),
  website: optionalUrl(300),
  countryId: optionalId,
  contactName: optionalText(120),
  contactEmail: optionalText(200),
  contactPhone: optionalText(60),
})

/**
 * Resolve the client half of the lead form.
 *
 * The form offers two mutually exclusive paths — pick an existing client, or
 * type a new company — because README §34's rule that a returning customer must
 * not become a second client record only holds if picking the existing one is
 * as easy as typing a new one.
 */
async function resolveClient(
  actor: CurrentUser,
  formData: FormData,
): Promise<
  | { ok: true; clientId: string; contactId: string | null }
  | { ok: false; state: ActionState }
> {
  const existingId = optionalString(formData.get('clientId'))

  if (existingId) {
    const client = await prisma.client.findFirst({
      where: {
        id: existingId,
        isDeleted: false,
        ...(await clientVisibilityFilter(actor)),
      },
      select: { id: true },
    })

    if (!client) {
      return {
        ok: false,
        state: actionError('That client is not available.', {
          clientId: 'Choose a client you can see, or create a new one.',
        }),
      }
    }

    const contactId = optionalString(formData.get('primaryContactId'))
    if (contactId) {
      // The contact has to belong to the chosen client, or the lead's contact
      // and its client would name two different companies.
      const contact = await prisma.clientContact.findFirst({
        where: { id: contactId, clientId: client.id },
        select: { id: true },
      })

      if (!contact) {
        return {
          ok: false,
          state: actionError('That contact does not belong to the chosen client.', {
            primaryContactId: 'Choose one of this client’s contacts.',
          }),
        }
      }
    }

    return { ok: true, clientId: client.id, contactId }
  }

  const parsed = newClientSchema.safeParse(formValues(formData))
  if (!parsed.success) return { ok: false, state: fromZodError(parsed.error) }

  const data = parsed.data
  const overrideReason = optionalString(formData.get('overrideReason'))

  const duplicates = await findClientDuplicates({
    clientName: data.clientName,
    companyName: data.companyName,
    website: data.website,
    contactEmail: data.contactEmail,
    contactPhone: data.contactPhone,
  })

  if (duplicates.length > 0 && !overrideReason) {
    return {
      ok: false,
      state: actionWarning(
        'We may already have this company. Open the match and add the lead there, or give a reason to create a second record.',
        duplicates,
      ),
    }
  }

  const domain = emailDomain(data.contactEmail)

  try {
    const created = await auditedTransaction(async (tx) => {
      const client = await tx.client.create({
        data: {
          clientName: data.clientName,
          companyName: data.companyName,
          website: data.website,
          countryId: data.countryId,
          ownerId: actor.id,
          clientCode: await nextClientCode(tx),
          dedupeKey: buildDedupeKey(data.clientName, domain),
        },
        select: { id: true },
      })

      const contact = data.contactName
        ? await tx.clientContact.create({
            data: {
              clientId: client.id,
              name: data.contactName,
              email: data.contactEmail,
              ...contactPhoneFields(data.contactPhone),
              isPrimary: true,
            },
            select: { id: true },
          })
        : null

      return { clientId: client.id, contactId: contact?.id ?? null }
    })

    // Only once the client actually exists — recording a justification for a
    // record that failed to save would leave an audit entry pointing at
    // nothing. The form told the user this would be kept; keep it.
    if (overrideReason) {
      await recordDuplicateOverride({
        entityType: 'CLIENT',
        entityId: created.clientId,
        reason: overrideReason,
        warnings: duplicates,
        userId: actor.id,
      })
    }

    return { ok: true, ...created }
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      return {
        ok: false,
        state: actionError(
          'A client with this name and email domain already exists. Search for it in the client picker instead.',
          { clientName: 'This client is already on file.' },
        ),
      }
    }
    throw error
  }
}

export async function createLeadAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let createdId: string | null = null

  const result = await withAudit(PERMISSIONS.LEAD_CREATE, async (actor) => {
    const parsed = leadSchema.safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const data = parsed.data

    const vertical = await prisma.salesVertical.findFirst({
      where: { id: data.verticalId, isActive: true },
      select: { id: true, leadPrefix: true, name: true },
    })

    if (!vertical) {
      return actionError('That vertical is not available.', {
        verticalId: 'Choose an active vertical.',
      })
    }

    const client = await resolveClient(actor, formData)
    if (!client.ok) return client.state

    // Who sourced it. A BDE can only ever put their own name here; anyone who
    // can reassign may record that someone else generated the lead, which is
    // what makes BDE Performance (§27) honest when a manager enters a lead on
    // a colleague's behalf.
    const canAssign = await can(actor, PERMISSIONS.LEAD_ASSIGN)
    const generatedById =
      canAssign && data.generatedById ? data.generatedById : actor.id

    const owners = await prisma.user.findMany({
      where: {
        id: { in: [generatedById, data.assignedToId].filter((v): v is string => Boolean(v)) },
        isActive: true,
      },
      select: { id: true, name: true, teamId: true, departmentId: true },
    })

    const generatedBy = owners.find((user) => user.id === generatedById)
    if (!generatedBy) {
      return actionError('The person who generated this lead is not available.', {
        generatedById: 'Choose an active user.',
      })
    }

    const assignedTo = data.assignedToId
      ? owners.find((user) => user.id === data.assignedToId)
      : null

    if (data.assignedToId && !assignedTo) {
      return actionError('That user is not available for assignment.', {
        assignedToId: 'Choose an active user.',
      })
    }

    // Which day's outreach produced this. Re-checked here rather than trusted
    // from the form — see `isValidSourceActivity`. An id that no longer stands
    // up is dropped rather than refused: the link is a nicety, and losing the
    // lead over it would be the wrong trade.
    const sourceActivityId =
      data.sourceActivityId &&
      (await isValidSourceActivity(actor, data.sourceActivityId, vertical.id))
        ? data.sourceActivityId
        : null

    const now = new Date()

    const lead = await auditedTransaction(async (tx) => {
      const created = await tx.lead.create({
        data: {
          leadCode: await nextLeadCode(tx, vertical, now),
          clientId: client.clientId,
          primaryContactId: client.contactId,
          verticalId: vertical.id,
          sourceId: data.sourceId,
          serviceId: data.serviceId,
          productId: data.productId,
          title: data.title,
          requirementDescription: data.requirementDescription,
          expectedBudget: data.expectedBudget,
          expectedTimeline: data.expectedTimeline,
          priority: data.priority,
          additionalNotes: data.additionalNotes,
          campaignName: data.campaignName,
          referenceUrl: data.referenceUrl,
          sourceActivityId,
          expectedCloseDate: data.expectedCloseDate,
          nextFollowUpAt: data.nextFollowUpAt,
          generatedById: generatedBy.id,
          assignedToId: assignedTo?.id ?? null,
          // Team and department follow whoever is working it, falling back to
          // the person who sourced it while it is still unassigned.
          teamId: (assignedTo ?? generatedBy).teamId,
          departmentId: (assignedTo ?? generatedBy).departmentId,
          createdById: actor.id,
          stageChangedAt: now,
        },
        select: { id: true, leadCode: true },
      })

      await setInitialStage(tx, {
        leadId: created.id,
        verticalId: vertical.id,
        actorId: actor.id,
        at: now,
      })

      if (assignedTo) {
        await recordAssignment(tx, {
          leadId: created.id,
          fromUserId: null,
          toUserId: assignedTo.id,
          toName: assignedTo.name,
          actorId: actor.id,
          reason: 'Assigned at creation',
          at: now,
        })
      }

      return created
    })

    createdId = lead.id
    revalidatePath('/leads')
    revalidatePath(`/clients/${client.clientId}`)
    return actionSuccess(`${lead.leadCode} created.`)
  })

  // Outside the wrapper: `redirect` works by throwing, and throwing inside the
  // transaction body would roll back the lead that was just created.
  if (result.status === 'success' && createdId) redirect(`/leads/${createdId}`)

  return result
}

/** A lead this user is allowed to open. */
async function visibleLead(user: CurrentUser, id: string) {
  return prisma.lead.findFirst({
    where: { id, isDeleted: false, ...(await leadVisibilityFilter(user)) },
    select: { id: true, leadCode: true, clientId: true },
  })
}

export async function updateLeadAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.LEAD_EDIT, async (actor) => {
    const id = formData.get('id')
    if (typeof id !== 'string' || id === '') return actionError('Missing lead id.')

    const lead = await visibleLead(actor, id)
    if (!lead) return actionError('That lead no longer exists.')

    // The vertical decides the stage list, the code prefix and which modules
    // the lead exposes. Changing it after a stage history exists would leave
    // history pointing at stages the lead's new vertical does not contain, so
    // it is fixed at creation and omitted from this schema.
    //
    // `sourceActivityId` is omitted for a different reason: the edit form does
    // not render it, so it would parse as null and quietly unlink every lead
    // from the counter batch it came from on the next unrelated save.
    const parsed = leadSchema
      .omit({
        verticalId: true,
        generatedById: true,
        assignedToId: true,
        sourceActivityId: true,
      })
      .safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const data = parsed.data
    const primaryContactId = optionalString(formData.get('primaryContactId'))

    if (primaryContactId) {
      const contact = await prisma.clientContact.findFirst({
        where: { id: primaryContactId, clientId: lead.clientId },
        select: { id: true },
      })
      if (!contact) {
        return actionError('That contact does not belong to this lead’s client.', {
          primaryContactId: 'Choose one of the client’s contacts.',
        })
      }
    }

    // Deal value is the commercial decision, gated separately from editing the
    // requirement text — permission matrix row "Set deal value / mark Won-Lost".
    const dealValue = (await can(actor, PERMISSIONS.LEAD_COMMERCIAL))
      ? optionalMoney.safeParse(String(formData.get('dealValue') ?? ''))
      : null

    if (dealValue && !dealValue.success) {
      return actionError('Enter a valid deal value.', {
        dealValue: 'Enter an amount, or leave it blank.',
      })
    }

    await prisma.lead.update({
      where: { id },
      data: {
        ...data,
        primaryContactId,
        ...(dealValue ? { dealValue: dealValue.data } : {}),
      },
    })

    revalidatePath('/leads')
    revalidatePath(`/leads/${id}`)
    return actionSuccess('Changes saved.')
  })
}

export async function changeStageAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.LEAD_STAGE_CHANGE, async (actor) => {
    const id = formData.get('id')
    const toStageId = formData.get('toStageId')

    if (typeof id !== 'string' || id === '') return actionError('Missing lead id.')
    if (typeof toStageId !== 'string' || toStageId === '') {
      return actionError('Choose a stage.', { toStageId: 'Choose a stage.' })
    }

    const lead = await visibleLead(actor, id)
    if (!lead) return actionError('That lead no longer exists.')

    // Marking a lead Won or Lost is a separate capability from moving it along
    // the pipeline. `changeLeadStage` knows which stages are outcomes; the
    // check has to happen here, where the permission is in scope.
    const stage = await prisma.pipelineStage.findUnique({
      where: { id: toStageId },
      select: { isWon: true, isLost: true, name: true },
    })

    if (
      stage &&
      (stage.isWon || stage.isLost) &&
      !(await can(actor, PERMISSIONS.LEAD_COMMERCIAL))
    ) {
      return actionError(
        `You do not have permission to mark a lead ${stage.isWon ? 'Won' : 'Lost'}.`,
      )
    }

    const dealValueRaw = optionalString(formData.get('dealValue'))
    const dealValue = dealValueRaw
      ? optionalMoney.safeParse(dealValueRaw)
      : null

    if (dealValue && !dealValue.success) {
      return actionError('Enter a valid deal value.', {
        dealValue: 'Enter an amount, or leave it blank.',
      })
    }

    const result = await changeLeadStage({
      leadId: lead.id,
      toStageId,
      actorId: actor.id,
      reason: optionalString(formData.get('reason')),
      lostReasonId: optionalString(formData.get('lostReasonId')),
      lostNotes: optionalString(formData.get('lostNotes')),
      dealValue: dealValue?.success ? dealValue.data : null,
    })

    if (!result.ok) {
      return actionError(
        result.message,
        result.field ? { [result.field]: result.message } : undefined,
      )
    }

    revalidatePath('/leads')
    revalidatePath(`/leads/${lead.id}`)
    return actionSuccess(`${result.leadCode} moved to ${result.stageName}.`)
  })
}

export async function assignLeadAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.LEAD_ASSIGN, async (actor) => {
    const id = formData.get('id')
    const toUserId = formData.get('toUserId')

    if (typeof id !== 'string' || id === '') return actionError('Missing lead id.')
    if (typeof toUserId !== 'string' || toUserId === '') {
      return actionError('Choose who to assign it to.', {
        toUserId: 'Choose a user.',
      })
    }

    const lead = await visibleLead(actor, id)
    if (!lead) return actionError('That lead no longer exists.')

    const result = await assignLead({
      leadId: lead.id,
      toUserId,
      actorId: actor.id,
      reason: optionalString(formData.get('reason')),
    })

    if (!result.ok) {
      return actionError(
        result.message,
        result.field ? { [result.field]: result.message } : undefined,
      )
    }

    revalidatePath('/leads')
    revalidatePath(`/leads/${lead.id}`)
    return actionSuccess(`${result.leadCode} assigned to ${result.toName}.`)
  })
}

/** Soft delete (open question Q10) — the row and all its history survive. */
export async function deleteLeadAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.LEAD_DELETE, async (actor) => {
    const id = formData.get('id')
    if (typeof id !== 'string' || id === '') return actionError('Missing lead id.')

    const lead = await visibleLead(actor, id)
    if (!lead) return actionError('That lead no longer exists.')

    await prisma.lead.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date() },
    })

    revalidatePath('/leads')
    // The detail page too: without this, anyone still holding /leads/<id> open
    // keeps seeing a cached copy of a lead that no longer appears in any list.
    revalidatePath(`/leads/${id}`)
    return actionSuccess(
      `${lead.leadCode} deleted. Its history is intact and an administrator can restore it.`,
    )
  })
}
