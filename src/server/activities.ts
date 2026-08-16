'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/lib/db'
import { withAudit } from '@/lib/action'
import { can } from '@/lib/authz'
import { MANUAL_ACTIVITY_TYPES } from '@/lib/activity-types'
import { optionalDate, optionalText } from '@/lib/form-fields'
import { PERMISSIONS } from '@/lib/permissions'
import { resolveTarget, targetFromFormData, targetFromRow } from '@/lib/attachments'
import {
  actionError,
  actionSuccess,
  formValues,
  fromZodError,
  type ActionState,
} from '@/lib/form'

/**
 * The timeline (README §23): calls, emails, meetings, notes and their follow-up
 * dates, against a lead or a client.
 *
 * Shared rather than duplicated per screen because the record is shared — one
 * `Activity` table, one set of rules about who may write to it. Requirements
 * and candidates joined the same two functions in Phase 4 by extending
 * `AttachmentTarget`, with no change to either action beyond the parent lookup.
 */

const activitySchema = z.object({
  type: z.enum(MANUAL_ACTIVITY_TYPES, { message: 'Choose an activity type.' }),
  subject: z.string().trim().min(2, 'Say what happened.').max(200),
  notes: optionalText(4000),
  outcome: optionalText(500),
  activityDate: optionalDate,
  followUpDate: optionalDate,
})

export async function logActivityAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ACTIVITY_MANAGE, async (actor) => {
    const target = targetFromFormData(formData)
    if (!target) return actionError('Missing the record to attach this to.')

    const parsed = activitySchema.safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const resolved = await resolveTarget(actor, target)
    if (!resolved) return actionError('That record no longer exists.')

    const data = parsed.data

    await prisma.activity.create({
      data: {
        ...data,
        activityDate: data.activityDate ?? new Date(),
        userId: actor.id,
        ...resolved.link,
      },
    })

    // The lead carries the next follow-up so the list can sort and filter by it
    // without touching Activity. Only moved forward from what is already there:
    // logging a call you made last week must not pull a follow-up you already
    // set for next month back into the past.
    if (
      resolved.target.kind === 'lead' &&
      data.followUpDate &&
      data.followUpDate.getTime() > Date.now()
    ) {
      const lead = await prisma.lead.findUnique({
        where: { id: resolved.target.id },
        select: { nextFollowUpAt: true },
      })

      if (!lead?.nextFollowUpAt || lead.nextFollowUpAt > data.followUpDate) {
        await prisma.lead.update({
          where: { id: resolved.target.id },
          data: { nextFollowUpAt: data.followUpDate },
        })
      }
    }

    revalidatePath(resolved.path)
    return actionSuccess('Activity logged.')
  })
}

/**
 * Delete an activity.
 *
 * Hard, unlike everything else in this app: a note is not a business record
 * with dependants, and a mistyped one that can only be deactivated leaves the
 * timeline permanently wrong. The audit trail keeps the deletion and a snapshot
 * of what was removed, so nothing is actually lost.
 */
export async function deleteActivityAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ACTIVITY_MANAGE, async (actor) => {
    const id = formData.get('id')
    if (typeof id !== 'string' || id === '') return actionError('Missing activity id.')

    const activity = await prisma.activity.findUnique({
      where: { id },
      select: {
        userId: true,
        leadId: true,
        clientId: true,
        requirementId: true,
        candidateId: true,
      },
    })
    if (!activity) return actionError('That activity no longer exists.')

    const target = targetFromRow(activity)
    if (!target) return actionError('That activity is attached to a record you cannot see.')

    const resolved = await resolveTarget(actor, target)
    if (!resolved) return actionError('That record no longer exists.')

    // Seeing a lead is not the same as being entitled to rewrite its history.
    // Anyone senior enough to delete another person's note holds LEAD_DELETE.
    if (
      activity.userId !== actor.id &&
      !(await can(actor, PERMISSIONS.LEAD_DELETE))
    ) {
      return actionError('You can only delete activities you logged yourself.')
    }

    await prisma.activity.delete({ where: { id } })

    revalidatePath(resolved.path)
    return actionSuccess('Activity deleted.')
  })
}
