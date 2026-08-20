'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/lib/db'
import { withAudit } from '@/lib/action'
import { hashPassword } from '@/lib/auth/password'
import { recordAudit } from '@/lib/audit/record'
import { PERMISSIONS } from '@/lib/permissions'
import { MANAGERIAL_ROLES } from '@/lib/roles'
import {
  actionError,
  actionSuccess,
  checkboxValue,
  formValues,
  fromZodError,
  type ActionState,
} from '@/lib/form'

const ROLES = ['ADMIN', 'BDM', 'BDE'] as const

/** Blank <select> and <input> values arrive as '' and mean "not set". */
const optionalId = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .nullable()

const optionalText = z
  .string()
  .trim()
  .max(120)
  .transform((value) => (value === '' ? null : value))
  .nullable()

/**
 * Ten characters, matching the seed script's floor for the bootstrap admin.
 * Deliberately a length rule and nothing else: composition rules push people
 * towards `Password1!` and away from length, which is what actually helps.
 */
const password = z
  .string()
  .min(10, 'Password must be at least 10 characters.')
  .max(200)

const baseUserSchema = z.object({
  name: z.string().trim().min(2, 'Enter the full name.').max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Enter a valid email address.')
    .max(200),
  role: z.enum(ROLES, { message: 'Choose a role.' }),
  employeeCode: optionalText,
  designation: optionalText,
  phone: optionalText,
  departmentId: optionalId,
  verticalId: optionalId,
  reportingManagerId: optionalId,
})

const createUserSchema = baseUserSchema.extend({ password })

/**
 * Would setting `managerId` as the manager of `userId` create a loop?
 *
 * A cycle here is not cosmetic: `visibleUserIds` walks this chain with a
 * recursive CTE to decide what a manager may see. The CTE is depth-bounded so a
 * loop would not hang, but it would quietly produce the wrong visibility set,
 * which is a data-access bug. Cheaper to reject at the point of entry.
 */
async function createsReportingCycle(
  userId: string,
  managerId: string,
): Promise<boolean> {
  if (userId === managerId) return true

  // Walk until the chain ends. A `visited` set rather than a depth cap: a cap
  // terminates on a pre-existing loop but also gives up on a legitimately deep
  // chain, and "gave up" was being reported as "no cycle" — the one answer this
  // function must never guess at.
  const visited = new Set<string>()
  let cursor: string | null = managerId

  while (cursor && !visited.has(cursor)) {
    if (cursor === userId) return true
    visited.add(cursor)

    const manager: { reportingManagerId: string | null } | null =
      await prisma.user.findUnique({
        where: { id: cursor },
        select: { reportingManagerId: true },
      })

    cursor = manager?.reportingManagerId ?? null
  }

  return false
}

/**
 * A reporting manager confers visibility of everything beneath them, so the id
 * cannot be taken on trust from the form. The select only offers active
 * managerial users; this is what stops a hand-crafted request naming anyone
 * else — including a deactivated account or a BDE.
 */
async function invalidManager(
  reportingManagerId: string | null,
): Promise<string | null> {
  if (!reportingManagerId) return null

  const manager = await prisma.user.findUnique({
    where: { id: reportingManagerId },
    select: { isActive: true, role: true },
  })

  if (!manager) return 'That user no longer exists.'
  if (!manager.isActive) return 'That user is deactivated.'
  if (!MANAGERIAL_ROLES.includes(manager.role)) {
    return 'That role cannot hold direct reports.'
  }

  return null
}

/** Active people who report directly to this user. */
async function activeDirectReportCount(userId: string): Promise<number> {
  return prisma.user.count({
    where: { reportingManagerId: userId, isActive: true },
  })
}

/** How many active administrators remain if `excludingId` stops being one. */
async function otherActiveAdminCount(excludingId: string): Promise<number> {
  return prisma.user.count({
    where: { role: 'ADMIN', isActive: true, id: { not: excludingId } },
  })
}

export async function createUserAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ADMIN_USERS, async () => {
    const parsed = createUserSchema.safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const data = parsed.data

    if (await prisma.user.findUnique({ where: { email: data.email } })) {
      return actionError('That email address is already in use.', {
        email: 'A user with this address already exists.',
      })
    }

    if (
      data.employeeCode &&
      (await prisma.user.findUnique({
        where: { employeeCode: data.employeeCode },
      }))
    ) {
      return actionError('That employee code is already in use.', {
        employeeCode: 'Already assigned to another user.',
      })
    }

    const managerProblem = await invalidManager(data.reportingManagerId)
    if (managerProblem) {
      return actionError(
        'That reporting manager cannot be used.',
        { reportingManagerId: managerProblem },
      )
    }

    const { password: plainPassword, ...profile } = data

    await prisma.user.create({
      data: {
        ...profile,
        passwordHash: await hashPassword(plainPassword),
        isActive: checkboxValue(formData, 'isActive'),
      },
    })

    revalidatePath('/admin/users')
    return actionSuccess(`${data.name} has been added.`)
  })
}

export async function updateUserAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ADMIN_USERS, async (actor) => {
    const id = formData.get('id')
    if (typeof id !== 'string' || id === '') {
      return actionError('Missing user id.')
    }

    const parsed = baseUserSchema.safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const data = parsed.data

    const existing = await prisma.user.findUnique({ where: { id } })
    if (!existing) return actionError('That user no longer exists.')

    const clash = await prisma.user.findUnique({ where: { email: data.email } })
    if (clash && clash.id !== id) {
      return actionError('That email address is already in use.', {
        email: 'A user with this address already exists.',
      })
    }

    if (data.employeeCode) {
      const codeClash = await prisma.user.findUnique({
        where: { employeeCode: data.employeeCode },
      })
      if (codeClash && codeClash.id !== id) {
        return actionError('That employee code is already in use.', {
          employeeCode: 'Already assigned to another user.',
        })
      }
    }

    // Only vet a manager actually being chosen: an existing chain whose manager
    // has since been deactivated must survive an unrelated edit, or the user
    // becomes uneditable for a reason the form never explains.
    if (data.reportingManagerId !== existing.reportingManagerId) {
      const managerProblem = await invalidManager(data.reportingManagerId)
      if (managerProblem) {
        return actionError('That reporting manager cannot be used.', {
          reportingManagerId: managerProblem,
        })
      }
    }

    if (
      data.reportingManagerId &&
      (await createsReportingCycle(id, data.reportingManagerId))
    ) {
      return actionError('That reporting manager would create a loop.', {
        reportingManagerId:
          'This person already reports to the user, directly or indirectly.',
      })
    }

    // Moving someone to a role that cannot hold reports would orphan the people
    // under them: `visibleUserIds` walks this chain, so their records would
    // silently drop out of the new manager's scope with nothing to show why.
    if (
      !MANAGERIAL_ROLES.includes(data.role) &&
      MANAGERIAL_ROLES.includes(existing.role)
    ) {
      const reports = await activeDirectReportCount(id)
      if (reports > 0) {
        return actionError(
          `${existing.name} has ${reports} active direct report(s). Move them to another manager before changing this role.`,
          { role: 'Reassign their direct reports first.' },
        )
      }
    }

    // Demoting the last administrator locks everyone out of master data and
    // the permission matrix, with no way back through the UI.
    if (
      existing.role === 'ADMIN' &&
      data.role !== 'ADMIN' &&
      (await otherActiveAdminCount(id)) === 0
    ) {
      return actionError(
        'This is the only active administrator. Promote someone else first.',
        { role: 'At least one active administrator is required.' },
      )
    }

    if (actor.id === id && data.role !== existing.role) {
      return actionError('You cannot change your own role.', {
        role: 'Ask another administrator to change your role.',
      })
    }

    await prisma.user.update({ where: { id }, data })

    revalidatePath('/admin/users')
    revalidatePath(`/admin/users/${id}`)
    return actionSuccess('Changes saved.')
  })
}

export async function setUserActiveAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ADMIN_USERS, async (actor) => {
    const id = formData.get('id')
    const isActive = formData.get('isActive') === 'true'

    if (typeof id !== 'string' || id === '') {
      return actionError('Missing user id.')
    }

    if (!isActive && actor.id === id) {
      return actionError('You cannot deactivate your own account.')
    }

    const existing = await prisma.user.findUnique({ where: { id } })
    if (!existing) return actionError('That user no longer exists.')

    // Same reasoning as the role guard above: a deactivated manager still sits
    // in the middle of the reporting chain, so their reports become visible to
    // nobody above them.
    if (!isActive) {
      const reports = await activeDirectReportCount(id)
      if (reports > 0) {
        return actionError(
          `${existing.name} has ${reports} active direct report(s). Move them to another manager first, or their records drop out of everyone's view.`,
        )
      }
    }

    if (
      !isActive &&
      existing.role === 'ADMIN' &&
      (await otherActiveAdminCount(id)) === 0
    ) {
      return actionError(
        'This is the only active administrator. Promote someone else first.',
      )
    }

    // Deactivation is this app's delete (open question Q10): the row stays, so
    // every lead they generated keeps its owner and the reports still add up.
    // `getCurrentUser` re-reads `isActive` on every request, so an open session
    // stops working immediately rather than at token expiry.
    await prisma.user.update({ where: { id }, data: { isActive } })

    revalidatePath('/admin/users')
    revalidatePath(`/admin/users/${id}`)
    return actionSuccess(
      isActive ? `${existing.name} reactivated.` : `${existing.name} deactivated.`,
    )
  })
}

export async function resetPasswordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ADMIN_USERS, async (actor) => {
    const id = formData.get('id')
    if (typeof id !== 'string' || id === '') {
      return actionError('Missing user id.')
    }

    const parsed = z
      .object({ password, confirmPassword: z.string() })
      .refine((value) => value.password === value.confirmPassword, {
        message: 'The two passwords do not match.',
        path: ['confirmPassword'],
      })
      .safeParse(formValues(formData))

    if (!parsed.success) return fromZodError(parsed.error)

    const existing = await prisma.user.findUnique({ where: { id } })
    if (!existing) return actionError('That user no longer exists.')

    await prisma.user.update({
      where: { id },
      data: { passwordHash: await hashPassword(parsed.data.password) },
    })

    // `passwordHash` is redacted in the ORM writer, which means that update
    // produced no audit row at all — the diff had nothing left to report. An
    // administrator resetting someone else's password is exactly the event a
    // trail exists for, so record it explicitly, naming the field and storing
    // nothing derived from the secret itself.
    await recordAudit({
      entityType: 'USER',
      entityId: id,
      action: 'UPDATE',
      fieldName: 'passwordHash',
      newValue: 'reset by administrator',
      userId: actor.id,
    })

    return actionSuccess(
      `Password reset. Give ${existing.name} the new password over a channel they already trust, and have them change it.`,
    )
  })
}
