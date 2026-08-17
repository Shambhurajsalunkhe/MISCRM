'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { auditedTransaction, prisma } from '@/lib/db'
import { withAudit } from '@/lib/action'
import { recordAudit } from '@/lib/audit/record'
import { nextContractCode } from '@/lib/codes'
import { PERMISSIONS } from '@/lib/permissions'
import { leadForCommercials } from '@/lib/commercials/access'
import { CONTRACT_STATUS_LABELS } from '@/lib/commercials/display'
import { toCents } from '@/lib/commercials/money'
import { leadChildVisibilityFilter } from '@/lib/visibility'
import { optionalDate, optionalMoney, optionalText } from '@/lib/form-fields'
import {
  actionError,
  actionSuccess,
  formValues,
  fromZodError,
  optionalString,
  type ActionState,
} from '@/lib/form'
import type { CurrentUser } from '@/lib/auth/session'
import type { BillingCycle, ContractStatus } from '@/generated/prisma/enums'

/**
 * Digital Marketing contracts (README §19, decision D10).
 *
 * A contract is a post-Won record rather than a stage: the funnel draws it below
 * WON, and nothing here touches `Lead.currentStageId`. What it does carry is the
 * billing cycle, which is the thing that decides whether one invoice or twelve
 * get raised against it — and that is why a contract exists at all rather than
 * the retainer being a single number on the lead.
 *
 * Gated on `commercial.manage`, scoped through the lead, same as quotations.
 */

const contractSchema = z.object({
  contractValue: optionalMoney,
  billingCycle: z.enum([
    'ONE_TIME',
    'MONTHLY',
    'QUARTERLY',
    'MILESTONE',
    'RETAINER',
  ] as const satisfies readonly BillingCycle[]),
  startDate: optionalDate,
  endDate: optionalDate,
  signedDate: optionalDate,
  notes: optionalText(4000),
})

const STATUSES = new Set<string>([
  'DRAFT',
  'SENT',
  'SIGNED',
  'ACTIVE',
  'COMPLETED',
  'TERMINATED',
])

async function visibleContract(user: CurrentUser, id: string) {
  return prisma.contract.findFirst({
    where: { id, ...(await leadChildVisibilityFilter(user)) },
    select: {
      id: true,
      contractNumber: true,
      status: true,
      leadId: true,
      contractValue: true,
      signedDate: true,
    },
  })
}

/** Both ends of the term, checked together rather than field by field. */
function checkDates(data: {
  startDate: Date | null
  endDate: Date | null
}): ActionState | null {
  if (data.startDate && data.endDate && data.startDate > data.endDate) {
    return actionError('The contract ends before it starts.', {
      endDate: 'Must be on or after the start date.',
    })
  }
  return null
}

export async function createContractAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let createdId: string | null = null

  const result = await withAudit(PERMISSIONS.COMMERCIAL_MANAGE, async (actor) => {
    const leadId = optionalString(formData.get('leadId'))
    if (!leadId) {
      return actionError('A contract has to belong to a lead.', {
        leadId: 'Choose the lead this contract is for.',
      })
    }

    const lead = await leadForCommercials(actor, leadId)
    if (!lead) {
      return actionError('That lead is not available.', {
        leadId: 'Choose a lead you can see.',
      })
    }

    if (!lead.vertical.usesContracts) {
      return actionError(
        `${lead.vertical.name} leads do not use contracts. Turn the contracts module on for the vertical in Master Data if that is wrong.`,
        { leadId: 'This lead’s vertical has no contracts module.' },
      )
    }

    const parsed = contractSchema.safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const data = parsed.data

    const dateError = checkDates(data)
    if (dateError) return dateError

    if (toCents(data.contractValue) <= 0) {
      return actionError('Enter what the contract is worth.', {
        contractValue: 'A contract needs a value above zero.',
      })
    }

    const contract = await auditedTransaction(async (tx) =>
      tx.contract.create({
        data: {
          contractNumber: await nextContractCode(tx),
          leadId: lead.id,
          contractValue: data.contractValue!,
          billingCycle: data.billingCycle,
          startDate: data.startDate,
          endDate: data.endDate,
          signedDate: data.signedDate,
          // A contract with a signed date is a signed contract. Asking for both
          // and trusting the person to keep them in step is how a signed
          // agreement ends up sitting in Draft for a quarter.
          status: data.signedDate ? 'SIGNED' : 'DRAFT',
          notes: data.notes,
        },
        select: { id: true, contractNumber: true },
      }),
    )

    createdId = contract.id
    revalidateLead(lead.id)
    revalidatePath('/contracts')
    return actionSuccess(`${contract.contractNumber} created.`)
  })

  if (result.status === 'success' && createdId) {
    redirect(`/contracts/${createdId}`)
  }

  return result
}

/**
 * Amend a contract.
 *
 * The value stays editable throughout, unlike a quotation's lines: a retainer
 * that goes up in month seven is the same agreement on new terms, and the
 * invoices already raised against it keep their own amounts. What that means in
 * practice is that a contract's value is not a sum of its invoices and was
 * never meant to be — the register shows both, side by side.
 */
export async function updateContractAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.COMMERCIAL_MANAGE, async (actor) => {
    const id = optionalString(formData.get('id'))
    if (!id) return actionError('Missing contract id.')

    const contract = await visibleContract(actor, id)
    if (!contract) return actionError('That contract no longer exists.')

    const parsed = contractSchema.safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const data = parsed.data

    const dateError = checkDates(data)
    if (dateError) return dateError

    if (toCents(data.contractValue) <= 0) {
      return actionError('Enter what the contract is worth.', {
        contractValue: 'A contract needs a value above zero.',
      })
    }

    await prisma.contract.update({
      where: { id: contract.id },
      data: {
        contractValue: data.contractValue!,
        billingCycle: data.billingCycle,
        startDate: data.startDate,
        endDate: data.endDate,
        signedDate: data.signedDate,
        notes: data.notes,
      },
    })

    revalidateContract(contract)
    return actionSuccess('Changes saved.')
  })
}

export async function setContractStatusAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.COMMERCIAL_MANAGE, async (actor) => {
    const id = optionalString(formData.get('id'))
    const status = formData.get('status')

    if (!id) return actionError('Missing contract id.')
    if (typeof status !== 'string' || !STATUSES.has(status)) {
      return actionError('Choose a status.', { status: 'Choose a status.' })
    }

    const contract = await visibleContract(actor, id)
    if (!contract) return actionError('That contract no longer exists.')

    const next = status as ContractStatus
    if (next === contract.status) {
      return actionError(
        `${contract.contractNumber} is already ${CONTRACT_STATUS_LABELS[next].toLowerCase()}.`,
      )
    }

    await auditedTransaction(async (tx) => {
      await tx.contract.update({
        where: { id: contract.id },
        data: {
          status: next,
          // Signing stamps the date *only* if nobody typed one — the same rule
          // the create path follows, from the other direction. Stamping
          // unconditionally would overwrite a signing date somebody recorded
          // under Terms with today's, losing the real one with nothing on
          // screen to say it changed.
          ...(next === 'SIGNED' && !contract.signedDate
            ? { signedDate: signedDateFallback() }
            : {}),
        },
      })

      await recordAudit({
        entityType: 'CONTRACT',
        entityId: contract.id,
        action: 'UPDATE',
        fieldName: 'status',
        oldValue: contract.status,
        newValue: next,
        userId: actor.id,
      })
    })

    revalidateContract(contract)
    return actionSuccess(
      `${contract.contractNumber} marked ${CONTRACT_STATUS_LABELS[next].toLowerCase()}.`,
    )
  })
}

/** Today, for a contract signed through the status control. */
function signedDateFallback(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

/**
 * Delete a contract.
 *
 * Only a draft, and only while nothing has been billed against it. A contract
 * that reached the client is a record of what was agreed; the way to end one is
 * TERMINATED, which says so.
 */
export async function deleteContractAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let leadId: string | null = null

  const result = await withAudit(PERMISSIONS.COMMERCIAL_MANAGE, async (actor) => {
    const id = optionalString(formData.get('id'))
    if (!id) return actionError('Missing contract id.')

    const contract = await visibleContract(actor, id)
    if (!contract) return actionError('That contract no longer exists.')

    if (contract.status !== 'DRAFT') {
      return actionError(
        `${contract.contractNumber} has been ${CONTRACT_STATUS_LABELS[contract.status].toLowerCase()}, so it stays in the record. Terminate it instead if the engagement ended.`,
      )
    }

    const invoiced = await prisma.invoice.count({
      where: { contractId: contract.id },
    })
    if (invoiced > 0) {
      return actionError(
        `${contract.contractNumber} has invoices against it and cannot be deleted.`,
      )
    }

    await prisma.contract.delete({ where: { id: contract.id } })

    leadId = contract.leadId
    revalidateContract(contract)
    return actionSuccess(`${contract.contractNumber} deleted.`)
  })

  if (result.status === 'success' && leadId) {
    redirect(`/leads/${leadId}/commercials`)
  }

  return result
}

function revalidateLead(leadId: string) {
  revalidatePath(`/leads/${leadId}`)
  revalidatePath(`/leads/${leadId}/commercials`)
}

function revalidateContract(contract: { id: string; leadId: string }) {
  revalidatePath('/contracts')
  revalidatePath(`/contracts/${contract.id}`)
  revalidateLead(contract.leadId)
}
