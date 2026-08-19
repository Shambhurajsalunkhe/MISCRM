'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/lib/db'
import { withAudit } from '@/lib/action'
import { can } from '@/lib/authz'
import { MANUAL_ACTIVITY_TYPES } from '@/lib/activity-types'
import { optionalDate, optionalText, requiredDate } from '@/lib/form-fields'
import { PERMISSIONS } from '@/lib/permissions'
import { resolveTarget, targetFromFormData, targetFromRow } from '@/lib/attachments'
import { isActivityKind } from '@/lib/attachment-kinds'
import type { CurrentUser } from '@/lib/auth/session'
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

    // `Document` has a column for all eight parents; `Activity` has four. No
    // screen offers a timeline on the other four, so this only ever fires for a
    // hand-crafted request — but without it that request reaches Prisma with an
    // unknown column and comes back as a generic failure, which is the wrong
    // way to learn that a parent was never supported.
    if (!isActivityKind(target.kind)) {
      return actionError('Activities cannot be logged against that record.')
    }

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

/**
 * Arrange a call or meeting: an `Activity` with `isPlanned`, dated forward.
 *
 * Separate from `logActivityAction` rather than a flag on it, because the two
 * validate differently in ways that matter at the point of entry. A log accepts
 * a blank date and means "now"; a plan without a date and time is not a plan, so
 * the field is required. A log takes an outcome, which a plan cannot have yet.
 *
 * The date is deliberately *not* forced to be in the future. Somebody writing up
 * Monday's diary on Tuesday morning would otherwise be told their own week is
 * invalid, and the panel already sorts an overdue plan to the top and marks it
 * so, which is more useful than a rejection.
 */
const planSchema = z.object({
  type: z.enum(MANUAL_ACTIVITY_TYPES, { message: 'Choose an activity type.' }),
  subject: z.string().trim().min(2, 'Say what this is about.').max(200),
  notes: optionalText(4000),
  activityDate: requiredDate('Choose a date and time.'),
})

export async function scheduleActivityAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ACTIVITY_MANAGE, async (actor) => {
    const target = targetFromFormData(formData)
    if (!target) return actionError('Choose the lead this is about.')

    if (!isActivityKind(target.kind)) {
      return actionError('Activities cannot be scheduled against that record.')
    }

    const parsed = planSchema.safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const resolved = await resolveTarget(actor, target)
    if (!resolved) return actionError('That record no longer exists.')

    await prisma.activity.create({
      data: {
        ...parsed.data,
        isPlanned: true,
        userId: actor.id,
        ...resolved.link,
      },
    })

    // Both the panel and the lead it belongs to.
    revalidatePath('/leads')
    revalidatePath(resolved.path)
    return actionSuccess('Scheduled.')
  })
}

/**
 * Whose plan is it, and may this person change it?
 *
 * Owner-only, and not widened to LEAD_DELETE the way deleting a note is. A
 * diary entry is an arrangement between one person and a client: moving
 * somebody else's call does not correct a record, it changes a commitment they
 * made and will be held to.
 */
async function ownPlan(
  actor: CurrentUser,
  id: unknown,
): Promise<
  | { ok: true; id: string; path: string }
  | { ok: false; state: ActionState }
> {
  if (typeof id !== 'string' || id === '') {
    return { ok: false, state: actionError('Missing the scheduled activity.') }
  }

  const plan = await prisma.activity.findUnique({
    where: { id },
    select: {
      userId: true,
      isPlanned: true,
      leadId: true,
      clientId: true,
      requirementId: true,
      candidateId: true,
    },
  })

  if (!plan || !plan.isPlanned) {
    return {
      ok: false,
      state: actionError('That scheduled activity no longer exists.'),
    }
  }

  if (plan.userId !== actor.id) {
    return {
      ok: false,
      state: actionError('You can only change your own scheduled activities.'),
    }
  }

  // The record the plan hangs off, so the caller can revalidate the lead as
  // well as the panel. Marking a call done adds it to that lead's timeline;
  // without this, a visit to the lead straight afterwards can be served the
  // router's cached payload from before the change.
  const target = targetFromRow(plan)
  if (!target) {
    return {
      ok: false,
      state: actionError('That scheduled activity is attached to a record you cannot see.'),
    }
  }

  // The real actor, not a stand-in: resolveTarget applies the visibility
  // filter, which reads the role as well as the id.
  const resolved = await resolveTarget(actor, target)
  return { ok: true, id, path: resolved?.path ?? '/leads' }
}

/** Move a scheduled call to a different date and time. */
export async function rescheduleActivityAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ACTIVITY_MANAGE, async (actor) => {
    const found = await ownPlan(actor, formData.get('id'))
    if (!found.ok) return found.state

    const parsed = requiredDate('Choose a date and time.').safeParse(
      formValues(formData).activityDate,
    )
    if (!parsed.success) {
      return actionError('Enter a valid date and time.', {
        activityDate: 'Enter a valid date and time.',
      })
    }

    await prisma.activity.update({
      where: { id: found.id },
      data: { activityDate: parsed.data },
    })

    revalidatePath('/leads')
    revalidatePath(found.path)
    return actionSuccess('Rescheduled.')
  })
}

/**
 * Mark a scheduled call as done, which turns the plan into the history entry
 * for it — the same row, with the flag cleared.
 *
 * `activityDate` is left at the arranged time rather than moved to now. The
 * arranged time is what the timeline should read, and a call marked done three
 * days late is not a call that happened three days late.
 */
export async function completeActivityAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ACTIVITY_MANAGE, async (actor) => {
    const found = await ownPlan(actor, formData.get('id'))
    if (!found.ok) return found.state

    await prisma.activity.update({
      where: { id: found.id },
      data: { isPlanned: false },
    })

    revalidatePath('/leads')
    revalidatePath(found.path)
    return actionSuccess('Marked as done. It is now in the lead’s timeline.')
  })
}
