'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { auditedTransaction, prisma } from '@/lib/db'
import { withAudit } from '@/lib/action'
import { can } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { leadForCommercials } from '@/lib/commercials/access'
import { leadChildVisibilityFilter } from '@/lib/visibility'
import { DEMO_STATUS_LABELS } from '@/lib/commercials/display'
import { optionalDate, optionalId, optionalText } from '@/lib/form-fields'
import {
  actionError,
  actionSuccess,
  formValues,
  fromZodError,
  optionalString,
  type ActionState,
} from '@/lib/form'
import type { CurrentUser } from '@/lib/auth/session'
import type { DemoStatus } from '@/generated/prisma/enums'

/**
 * Demos under a Product Sales lead (README §20, decision D11).
 *
 * One lead, many demos — the arithmetic on your dashboard is *120 demos against
 * 60 leads*, which only works if a demo is a repeatable child record rather than
 * a stage. Nothing here moves the lead's stage for that reason: "Demo Scheduled"
 * and "Demo Completed" are stages in the Product Sales list an owner advances
 * deliberately, and inferring a stage move from the third demo of five would
 * write history that never happened.
 *
 * Gated on `activity.manage` rather than `lead.edit`. Running a demo and writing
 * down what happened in it is the same kind of act as logging the call that
 * arranged it, and the permission matrix gives a BDE that capability while
 * keeping stage changes away from them (docs/03 §2). An administrator revoking
 * "add activities & documents" gets a coherent result: that person stops
 * recording what they did, including demos.
 */

const demoSchema = z.object({
  scheduledAt: optionalDate,
  productId: optionalId,
  conductedById: optionalId,
  attendees: optionalText(500),
  notes: optionalText(4000),
})

const DEMO_STATUSES_SET = new Set<string>([
  'SCHEDULED',
  'COMPLETED',
  'NO_SHOW',
  'RESCHEDULED',
  'CANCELLED',
])

/** A demo this user may touch, resolved through its lead. */
async function visibleDemo(user: CurrentUser, id: string) {
  return prisma.demo.findFirst({
    where: { id, ...(await leadChildVisibilityFilter(user)) },
    select: {
      id: true,
      leadId: true,
      status: true,
      completedAt: true,
      scheduledAt: true,
      conductedById: true,
    },
  })
}

export async function scheduleDemoAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ACTIVITY_MANAGE, async (actor) => {
    const leadId = optionalString(formData.get('leadId'))
    if (!leadId) return actionError('Missing lead id.')

    const lead = await leadForCommercials(actor, leadId)
    if (!lead) return actionError('That lead is not available.')

    if (!lead.vertical.usesDemos) {
      return actionError(
        `${lead.vertical.name} leads do not carry demos. Turn the demos module on for the vertical in Master Data if that is wrong.`,
      )
    }

    const parsed = demoSchema.safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const data = parsed.data
    if (!data.scheduledAt) {
      return actionError('Say when the demo is.', {
        scheduledAt: 'Choose a date and time.',
      })
    }

    // Unattributed falls to the person entering it: a demo nobody conducted is
    // a demo nobody can be asked about. Still overridable, because a BDE often
    // books a demo their pre-sales colleague will run.
    let conductedById = actor.id
    if (data.conductedById) {
      const owner = await prisma.user.findFirst({
        where: { id: data.conductedById, isActive: true },
        select: { id: true },
      })
      if (!owner) {
        return actionError('That user is not available.', {
          conductedById: 'Choose an active user.',
        })
      }
      conductedById = owner.id
    }

    await auditedTransaction(async (tx) => {
      await tx.demo.create({
        data: {
          leadId: lead.id,
          productId: data.productId,
          scheduledAt: data.scheduledAt!,
          conductedById,
          attendees: data.attendees,
          notes: data.notes,
        },
      })

      // The lead's timeline is where someone picking this account up will look,
      // and a demo booked for next Tuesday is exactly the kind of thing that
      // should carry a follow-up date.
      await tx.activity.create({
        data: {
          type: 'DEMO',
          subject: 'Demo scheduled',
          notes: data.attendees ? `Attendees: ${data.attendees}` : null,
          activityDate: new Date(),
          followUpDate: data.scheduledAt,
          userId: actor.id,
          leadId: lead.id,
        },
      })
    })

    revalidateDemos(lead.id)
    return actionSuccess('Demo scheduled.')
  })
}

/**
 * Record what happened, or move the date.
 *
 * `completedAt` is stamped by the outcome rather than typed, the same way an
 * interview round is: a demo with a result is a demo that happened, and a
 * separate date field is one more thing to leave blank. Anything other than
 * COMPLETED un-stamps it, so Demos Completed (docs/02 §4.6) never counts one
 * somebody re-opened.
 */
export async function updateDemoAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ACTIVITY_MANAGE, async (actor) => {
    const id = optionalString(formData.get('id'))
    if (!id) return actionError('Missing demo id.')

    const demo = await visibleDemo(actor, id)
    if (!demo) return actionError('That demo no longer exists.')

    const status = formData.get('status')
    if (typeof status !== 'string' || !DEMO_STATUSES_SET.has(status)) {
      return actionError('Choose an outcome.', { status: 'Choose an outcome.' })
    }

    const parsed = z
      .object({ scheduledAt: optionalDate, feedback: optionalText(4000) })
      .safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const next = status as DemoStatus
    const now = new Date()

    await prisma.demo.update({
      where: { id: demo.id },
      data: {
        status: next,
        scheduledAt: parsed.data.scheduledAt ?? demo.scheduledAt,
        feedback: parsed.data.feedback,
        completedAt: next === 'COMPLETED' ? (demo.completedAt ?? now) : null,
      },
    })

    revalidateDemos(demo.leadId)
    return actionSuccess(`Demo marked ${DEMO_STATUS_LABELS[next].toLowerCase()}.`)
  })
}

/**
 * Remove a demo.
 *
 * Hard, like an activity: a demo booked against the wrong lead is a mistake
 * rather than a business record with dependants, and one that can only be
 * cancelled leaves it counting in Demos Scheduled for ever. Restricted to
 * whoever ran it or someone senior enough to delete a lead, which is the same
 * line the timeline draws.
 */
export async function deleteDemoAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ACTIVITY_MANAGE, async (actor) => {
    const id = optionalString(formData.get('id'))
    if (!id) return actionError('Missing demo id.')

    const demo = await visibleDemo(actor, id)
    if (!demo) return actionError('That demo no longer exists.')

    if (
      demo.conductedById !== actor.id &&
      !(await can(actor, PERMISSIONS.LEAD_DELETE))
    ) {
      return actionError('You can only remove demos you were down to conduct.')
    }

    await prisma.demo.delete({ where: { id: demo.id } })

    revalidateDemos(demo.leadId)
    return actionSuccess('Demo removed.')
  })
}

function revalidateDemos(leadId: string) {
  revalidatePath(`/leads/${leadId}/demos`)
  revalidatePath(`/leads/${leadId}`)
  revalidatePath(`/leads/${leadId}/timeline`)
}
