'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/lib/db'
import { withAudit } from '@/lib/action'
import { PERMISSIONS } from '@/lib/permissions'
import {
  actionError,
  actionSuccess,
  checkboxValue,
  formValues,
  fromZodError,
  type ActionState,
} from '@/lib/form'
import type { CommonStage } from '@/generated/prisma/enums'

const COMMON_STAGES = [
  'NEW',
  'CONTACTED',
  'REQUIREMENT_GATHERING',
  'PROPOSAL',
  'NEGOTIATION',
  'WON',
  'LOST',
] as const

const stageCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-Z][A-Z0-9_]{1,39}$/,
    'Letters, digits and underscores, starting with a letter.',
  )

const agingDays = z
  .string()
  .trim()
  // Blank means "never flag this stage". Zero would mean "flag the moment a
  // lead arrives", which reports every lead as aging on day one and makes the
  // Pipeline Aging report useless — almost always a mistyped blank.
  .regex(
    /^(|[1-9]\d{0,3})$/,
    'A whole number of days above zero, or blank for no threshold.',
  )
  .transform((value) => (value === '' ? null : Number(value)))

const pipelineStageSchema = z.object({
  id: z.string().trim().optional(),
  verticalId: z.string().trim().min(1, 'Choose a vertical.'),
  name: z.string().trim().min(2, 'Enter a stage name.').max(60),
  code: stageCode,
  commonStage: z.enum(COMMON_STAGES, { message: 'Choose a common stage.' }),
  agingThresholdDays: agingDays,
})

const simpleStageSchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().min(2, 'Enter a stage name.').max(60),
  code: stageCode,
  agingThresholdDays: agingDays,
})

/**
 * The outcome flags and the common-stage mapping have to agree.
 *
 * `isWon` is what the funnel counts as a conversion and what derives
 * `Lead.status`; `commonStage` is what the cross-vertical pipeline chart buckets
 * by (decision D5). A stage flagged Won but mapped to NEGOTIATION would be
 * counted as a win by one and as still-open by the other, and the two numbers
 * on the dashboard would disagree with no obvious cause.
 */
function checkOutcomeConsistency(
  isWon: boolean,
  isLost: boolean,
  commonStage: CommonStage,
): ActionState | null {
  if (isWon && isLost) {
    return actionError('A stage cannot be both Won and Lost.', {
      isWon: 'Pick one.',
    })
  }

  if (isWon && commonStage !== 'WON') {
    return actionError(
      'A stage marked Won must map to the WON common stage, or the pipeline chart and the conversion count will disagree.',
      { commonStage: 'Must be WON.' },
    )
  }

  if (isLost && commonStage !== 'LOST') {
    return actionError(
      'A stage marked Lost must map to the LOST common stage.',
      { commonStage: 'Must be LOST.' },
    )
  }

  if (commonStage === 'WON' && !isWon) {
    return actionError(
      'A stage mapped to WON must be flagged as the winning stage.',
      { isWon: 'Required for a WON mapping.' },
    )
  }

  if (commonStage === 'LOST' && !isLost) {
    return actionError(
      'A stage mapped to LOST must be flagged as the losing stage.',
      { isLost: 'Required for a LOST mapping.' },
    )
  }

  return null
}

export async function savePipelineStageAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ADMIN_MASTER, async () => {
    const parsed = pipelineStageSchema.safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const { id, verticalId: submittedVerticalId, ...data } = parsed.data
    const isWon = checkboxValue(formData, 'isWon')
    const isLost = checkboxValue(formData, 'isLost')

    const inconsistent = checkOutcomeConsistency(isWon, isLost, data.commonStage)
    if (inconsistent) return inconsistent

    // On an edit, the vertical comes from the stored row, not the form.
    //
    // Every check below is scoped by vertical — the code-uniqueness lookup and
    // the one-winner scan. Trusting a submitted `verticalId` would let a stale
    // or altered form validate against vertical A while updating a stage that
    // actually belongs to vertical B, which is how a vertical ends up with two
    // winning stages despite the guard.
    let verticalId = submittedVerticalId

    if (id) {
      const stored = await prisma.pipelineStage.findUnique({
        where: { id },
        select: { verticalId: true },
      })
      if (!stored) return actionError('That stage no longer exists.')

      if (stored.verticalId !== submittedVerticalId) {
        return actionError(
          'That stage belongs to a different vertical. Reload the page and try again.',
        )
      }

      verticalId = stored.verticalId
    }

    const clash = await prisma.pipelineStage.findUnique({
      where: { verticalId_code: { verticalId, code: data.code } },
      select: { id: true },
    })
    if (clash && clash.id !== id) {
      return actionError('That stage code already exists for this vertical.', {
        code: 'Already in use.',
      })
    }

    // Exactly one winning and one losing stage per vertical: every conversion
    // percentage in docs/02 is "reached the won stage / entered the funnel",
    // which has no answer if two stages both claim to be the win.
    for (const [flag, value] of [
      ['isWon', isWon],
      ['isLost', isLost],
    ] as const) {
      if (!value) continue

      const other = await prisma.pipelineStage.findFirst({
        where: { verticalId, [flag]: true, ...(id ? { id: { not: id } } : {}) },
        select: { name: true },
      })

      if (other) {
        return actionError(
          `${other.name} is already the ${flag === 'isWon' ? 'winning' : 'losing'} stage for this vertical. Clear it there first.`,
          { [flag]: 'Only one per vertical.' },
        )
      }
    }

    if (id) {
      await prisma.pipelineStage.update({
        where: { id },
        data: { ...data, isWon, isLost },
      })
    } else {
      // New stages go to the end of the list; order is changed with the
      // up/down controls rather than by typing a number.
      const last = await prisma.pipelineStage.findFirst({
        where: { verticalId },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      })

      await prisma.pipelineStage.create({
        data: {
          ...data,
          isWon,
          isLost,
          verticalId,
          sortOrder: (last?.sortOrder ?? -1) + 1,
        },
      })
    }

    revalidatePath('/admin/master/stages')
    return actionSuccess(id ? 'Stage saved.' : `${data.name} added.`)
  })
}

export async function movePipelineStageAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ADMIN_MASTER, async () => {
    const id = formData.get('id')
    const direction = formData.get('direction')

    if (typeof id !== 'string' || id === '') return actionError('Missing id.')
    if (direction !== 'up' && direction !== 'down') {
      return actionError('Invalid direction.')
    }

    const stage = await prisma.pipelineStage.findUnique({
      where: { id },
      select: { id: true, verticalId: true, sortOrder: true },
    })
    if (!stage) return actionError('That stage no longer exists.')

    // Swap with the adjacent stage rather than renumbering the list, so a
    // concurrent edit elsewhere in the list cannot be clobbered.
    const neighbour = await prisma.pipelineStage.findFirst({
      where: {
        verticalId: stage.verticalId,
        sortOrder:
          direction === 'up'
            ? { lt: stage.sortOrder }
            : { gt: stage.sortOrder },
      },
      orderBy: { sortOrder: direction === 'up' ? 'desc' : 'asc' },
      select: { id: true, sortOrder: true },
    })

    if (!neighbour) {
      return actionSuccess('Already at the end of the list.')
    }

    await prisma.$transaction([
      prisma.pipelineStage.update({
        where: { id: stage.id },
        data: { sortOrder: neighbour.sortOrder },
      }),
      prisma.pipelineStage.update({
        where: { id: neighbour.id },
        data: { sortOrder: stage.sortOrder },
      }),
    ])

    revalidatePath('/admin/master/stages')
    return actionSuccess('Order updated.')
  })
}

export async function setPipelineStageActiveAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ADMIN_MASTER, async () => {
    const id = formData.get('id')
    const isActive = formData.get('isActive') === 'true'
    if (typeof id !== 'string' || id === '') return actionError('Missing id.')

    const stage = await prisma.pipelineStage.findUnique({
      where: { id },
      select: {
        name: true,
        isWon: true,
        isLost: true,
        _count: { select: { leadsAtStage: true } },
      },
    })
    if (!stage) return actionError('That stage no longer exists.')

    // Without a reachable Won or Lost stage the vertical has no way to close a
    // deal, and every conversion metric for it reads zero.
    if (!isActive && (stage.isWon || stage.isLost)) {
      return actionError(
        `${stage.name} is this vertical's ${stage.isWon ? 'winning' : 'losing'} stage. Deactivating it would leave no way to close a lead here.`,
      )
    }

    if (!isActive && stage._count.leadsAtStage > 0) {
      return actionError(
        `${stage._count.leadsAtStage} lead(s) are sitting at ${stage.name}. Move them on first — deactivating would strand them at a stage nobody can advance from.`,
      )
    }

    await prisma.pipelineStage.update({ where: { id }, data: { isActive } })

    revalidatePath('/admin/master/stages')
    return actionSuccess(isActive ? 'Stage reactivated.' : 'Stage deactivated.')
  })
}

// --- Requirement and candidate stages ---------------------------------------
// Single global lists (decision D8): staffing outcome lives on the Requirement,
// not the Lead, and the same list applies to every client.

export async function saveRequirementStageAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ADMIN_MASTER, async () => {
    const parsed = simpleStageSchema.safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const { id, ...data } = parsed.data
    const isWon = checkboxValue(formData, 'isWon')
    const isLost = checkboxValue(formData, 'isLost')

    if (isWon && isLost) {
      return actionError('A stage cannot be both Placement and Lost.', {
        isWon: 'Pick one.',
      })
    }

    const clash = await prisma.requirementStage.findUnique({
      where: { code: data.code },
      select: { id: true },
    })
    if (clash && clash.id !== id) {
      return actionError('That stage code is already in use.', {
        code: 'Already in use.',
      })
    }

    if (id) {
      await prisma.requirementStage.update({
        where: { id },
        data: { ...data, isWon, isLost },
      })
    } else {
      const last = await prisma.requirementStage.findFirst({
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      })
      await prisma.requirementStage.create({
        data: { ...data, isWon, isLost, sortOrder: (last?.sortOrder ?? -1) + 1 },
      })
    }

    revalidatePath('/admin/master/stages')
    return actionSuccess(id ? 'Stage saved.' : `${data.name} added.`)
  })
}

export async function saveCandidateStageAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ADMIN_MASTER, async () => {
    // Candidate stages have no aging threshold of their own — the requirement
    // they hang off carries it — so parse without that field.
    const parsed = simpleStageSchema
      .omit({ agingThresholdDays: true })
      .safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const { id, ...data } = parsed.data
    const isPlaced = checkboxValue(formData, 'isPlaced')
    const isRejected = checkboxValue(formData, 'isRejected')

    if (isPlaced && isRejected) {
      return actionError('A stage cannot be both Placed and Rejected.', {
        isPlaced: 'Pick one.',
      })
    }

    const clash = await prisma.candidateStage.findUnique({
      where: { code: data.code },
      select: { id: true },
    })
    if (clash && clash.id !== id) {
      return actionError('That stage code is already in use.', {
        code: 'Already in use.',
      })
    }

    if (id) {
      await prisma.candidateStage.update({
        where: { id },
        data: { ...data, isPlaced, isRejected },
      })
    } else {
      const last = await prisma.candidateStage.findFirst({
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      })
      await prisma.candidateStage.create({
        data: {
          ...data,
          isPlaced,
          isRejected,
          sortOrder: (last?.sortOrder ?? -1) + 1,
        },
      })
    }

    revalidatePath('/admin/master/stages')
    return actionSuccess(id ? 'Stage saved.' : `${data.name} added.`)
  })
}
