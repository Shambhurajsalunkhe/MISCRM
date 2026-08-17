'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/lib/db'
import { withAudit } from '@/lib/action'
import { can } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { reversePlacement } from '@/lib/staffing/placement'
import { requirementVisibilityFilter } from '@/lib/visibility'
import { optionalText } from '@/lib/form-fields'
import {
  actionError,
  actionSuccess,
  optionalString,
  type ActionState,
} from '@/lib/form'

/**
 * Reverse a placement (see `src/lib/staffing/placement.ts` for what that means
 * and why it is a record rather than a delete).
 *
 * **Two permissions, both required.** `staffing.requirement.manage` is what
 * marking someone as joined costs, and giving back the opening is the same
 * capability in reverse. `commercial.manage` is on top of it because a reversal
 * un-books revenue, and the matrix already separates working the pipeline from
 * touching what the company has earned. A recruiter can record the join; taking
 * the money back off the board is the account owner's call.
 *
 * The reason is mandatory. A reversed placement is a number that moved on
 * somebody's dashboard, and "why" is the only thing that makes that legible a
 * month later — the same argument Q2 makes for a backward stage move.
 */
export async function reversePlacementAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.STAFFING_REQUIREMENT_MANAGE, async (actor) => {
    if (!(await can(actor, PERMISSIONS.COMMERCIAL_MANAGE))) {
      return actionError(
        'Reversing a placement takes booked revenue off the reports, which your role does not include. Ask whoever owns the commercials on this account.',
      )
    }

    const id = optionalString(formData.get('id'))
    if (!id) return actionError('Missing placement id.')

    const reason = optionalText(1000).safeParse(
      String(formData.get('reason') ?? ''),
    )
    if (!reason.success || !reason.data) {
      return actionError('Say why the placement is being reversed.', {
        reason: 'A reason is required — this changes booked revenue.',
      })
    }

    // Scoped through the requirement, like everything else on the staffing side.
    const placement = await prisma.placement.findFirst({
      where: {
        id,
        requirement: {
          isDeleted: false,
          ...(await requirementVisibilityFilter(actor)),
        },
      },
      select: {
        id: true,
        leadId: true,
        requirementId: true,
        submissionId: true,
        candidateId: true,
      },
    })

    if (!placement) return actionError('That placement no longer exists.')

    const outcome = await reversePlacement({
      placementId: placement.id,
      reason: reason.data,
      actorId: actor.id,
    })

    if (!outcome.ok) return actionError(outcome.message)

    revalidatePath('/placements')
    revalidatePath('/reports/staffing')
    revalidatePath(`/requirements/${placement.requirementId}`)
    revalidatePath(
      `/requirements/${placement.requirementId}/submissions/${placement.submissionId}`,
    )
    revalidatePath(`/candidates/${placement.candidateId}`)
    revalidatePath(`/leads/${placement.leadId}`)
    revalidatePath(`/leads/${placement.leadId}/commercials`)

    return actionSuccess(
      outcome.leadStatusChanged
        ? `${outcome.candidateName}'s placement on ${outcome.requirementCode} reversed. The lead's outcome has been re-derived.`
        : `${outcome.candidateName}'s placement on ${outcome.requirementCode} reversed. The opening is available again.`,
    )
  })
}
