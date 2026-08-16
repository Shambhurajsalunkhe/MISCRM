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

const MODULE_FLAGS = [
  'usesRequirements',
  'usesCandidates',
  'usesDemos',
  'usesQuotations',
  'usesContracts',
  'usesInvoicing',
] as const

const verticalSchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().min(2, 'Enter a name.').max(60),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,4}$/, 'Two to four letters, e.g. UP.'),
  leadPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,4}$/, 'Two to four letters, e.g. UP.'),
  colorHex: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Six-digit hex, e.g. #14A800'),
  sortOrder: z
    .string()
    .trim()
    .regex(/^\d{1,3}$/, 'A whole number.')
    .transform(Number),
})

export async function saveVerticalAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ADMIN_MASTER, async () => {
    const parsed = verticalSchema.safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const { id, ...data } = parsed.data
    const flags = Object.fromEntries(
      MODULE_FLAGS.map((flag) => [flag, checkboxValue(formData, flag)]),
    ) as Record<(typeof MODULE_FLAGS)[number], boolean>

    const existing = id
      ? await prisma.salesVertical.findUnique({
          where: { id },
          select: { id: true, leadPrefix: true, _count: { select: { leads: true } } },
        })
      : null

    if (id && !existing) return actionError('That vertical no longer exists.')

    for (const [field, value] of [
      ['code', data.code],
      ['name', data.name],
      ['leadPrefix', data.leadPrefix],
    ] as const) {
      const clash = await prisma.salesVertical.findFirst({
        where: { [field]: value },
        select: { id: true },
      })
      if (clash && clash.id !== id) {
        return actionError(`That ${field === 'leadPrefix' ? 'lead prefix' : field} is already in use.`, {
          [field]: 'Already in use.',
        })
      }
    }

    // Lead codes are issued as `${leadPrefix}-0001` and stored on the row.
    // Changing the prefix does not rewrite codes that already exist, so the
    // vertical would end up with two code formats in one list and `LeadSequence`
    // still counting from the old one. Blocked once any lead exists.
    if (
      existing &&
      existing._count.leads > 0 &&
      existing.leadPrefix !== data.leadPrefix
    ) {
      return actionError(
        `This vertical already has ${existing._count.leads} lead(s) coded ${existing.leadPrefix}-0001. Changing the prefix now would leave two formats in the same list.`,
        { leadPrefix: 'Locked once leads exist.' },
      )
    }

    if (id) {
      await prisma.salesVertical.update({
        where: { id },
        data: { ...data, ...flags },
      })
    } else {
      await prisma.salesVertical.create({ data: { ...data, ...flags } })
    }

    revalidatePath('/admin/master/verticals')
    revalidatePath('/admin/master/stages')
    return actionSuccess(id ? 'Vertical saved.' : `${data.name} added.`)
  })
}

export async function setVerticalActiveAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ADMIN_MASTER, async () => {
    const id = formData.get('id')
    const isActive = formData.get('isActive') === 'true'
    if (typeof id !== 'string' || id === '') return actionError('Missing id.')

    const vertical = await prisma.salesVertical.findUnique({
      where: { id },
      select: { name: true, _count: { select: { leads: true } } },
    })
    if (!vertical) return actionError('That vertical no longer exists.')

    await prisma.salesVertical.update({ where: { id }, data: { isActive } })

    revalidatePath('/admin/master/verticals')
    // The stage editor's vertical picker labels inactive verticals.
    revalidatePath('/admin/master/stages')
    revalidatePath('/admin/master')
    return actionSuccess(
      isActive
        ? `${vertical.name} reactivated.`
        : `${vertical.name} deactivated — no new leads can be created against it. Its ${vertical._count.leads} existing lead(s) are untouched and still appear in reports.`,
    )
  })
}
