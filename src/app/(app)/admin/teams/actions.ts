'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { prisma } from '@/lib/db'
import { withAudit } from '@/lib/action'
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

const optionalId = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .nullable()

const departmentSchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().min(2, 'Enter a department name.').max(80),
})

const teamSchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().min(2, 'Enter a team name.').max(80),
  departmentId: optionalId,
  managerId: optionalId,
})

export async function saveDepartmentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ADMIN_USERS, async () => {
    const parsed = departmentSchema.safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const { id, name } = parsed.data

    const clash = await prisma.department.findUnique({ where: { name } })
    if (clash && clash.id !== id) {
      return actionError('A department with that name already exists.', {
        name: 'Already in use.',
      })
    }

    if (id) {
      await prisma.department.update({ where: { id }, data: { name } })
    } else {
      await prisma.department.create({ data: { name } })
    }

    revalidatePath('/admin/teams')
    return actionSuccess(id ? 'Department renamed.' : `${name} added.`)
  })
}

export async function setDepartmentActiveAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ADMIN_USERS, async () => {
    const id = formData.get('id')
    const isActive = formData.get('isActive') === 'true'
    if (typeof id !== 'string' || id === '') return actionError('Missing id.')

    const department = await prisma.department.findUnique({
      where: { id },
      select: { name: true, _count: { select: { users: true, teams: true } } },
    })
    if (!department) return actionError('That department no longer exists.')

    // Deactivating hides it from the pickers but leaves every existing user and
    // team pointing at it, so nobody's department silently becomes blank.
    await prisma.department.update({ where: { id }, data: { isActive } })

    revalidatePath('/admin/teams')
    return actionSuccess(
      isActive
        ? `${department.name} reactivated.`
        : `${department.name} deactivated. ${department._count.users} user(s) and ${department._count.teams} team(s) keep their existing assignment.`,
    )
  })
}

export async function saveTeamAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ADMIN_USERS, async () => {
    const parsed = teamSchema.safeParse(formValues(formData))
    if (!parsed.success) return fromZodError(parsed.error)

    const { id, name, departmentId, managerId } = parsed.data
    const staffingAccess = checkboxValue(formData, 'staffingAccess')

    // `@@unique([name, departmentId])` in the schema, checked here so the user
    // gets a sentence rather than a Prisma constraint error. Note that the
    // migration adds a partial index for the departmentId IS NULL case, which
    // `findFirst` reproduces correctly only because it filters on null
    // explicitly rather than omitting the key.
    const clash = await prisma.team.findFirst({
      where: { name, departmentId },
    })
    if (clash && clash.id !== id) {
      return actionError(
        'A team with that name already exists in that department.',
        { name: 'Already in use.' },
      )
    }

    // A team's manager sees every lead belonging to its members
    // (`visibleUserIds` joins on `Team.managerId`), so this id decides data
    // access and cannot be trusted from the form. The department is checked too,
    // for the duller reason that an unknown id would surface as a raw foreign
    // key error.
    if (departmentId) {
      const department = await prisma.department.findUnique({
        where: { id: departmentId },
        select: { id: true },
      })
      if (!department) {
        return actionError('That department no longer exists.', {
          departmentId: 'Unknown department.',
        })
      }
    }

    // Only vet a manager the administrator is actually choosing. An existing
    // assignment whose holder has since been deactivated must survive an
    // unrelated rename — rejecting it here would make the team uneditable
    // until someone noticed why.
    const previousManagerId = id
      ? ((
          await prisma.team.findUnique({
            where: { id },
            select: { managerId: true },
          })
        )?.managerId ?? null)
      : null

    if (managerId && managerId !== previousManagerId) {
      const manager = await prisma.user.findUnique({
        where: { id: managerId },
        select: { isActive: true, role: true },
      })

      if (!manager) {
        return actionError('That user no longer exists.', {
          managerId: 'Unknown user.',
        })
      }
      if (!manager.isActive) {
        return actionError('That user is deactivated.', {
          managerId: 'Deactivated users cannot manage a team.',
        })
      }
      if (!MANAGERIAL_ROLES.includes(manager.role)) {
        return actionError(
          'That role cannot manage a team — it would grant sight of every member’s leads.',
          { managerId: 'Not a managerial role.' },
        )
      }
    }

    if (id) {
      await prisma.team.update({
        where: { id },
        data: { name, departmentId, managerId, staffingAccess },
      })
    } else {
      await prisma.team.create({
        data: { name, departmentId, managerId, staffingAccess },
      })
    }

    // Say what the flag did, because it is the one field on this form whose
    // effect is invisible from this screen — it decides whether a whole section
    // of the sidebar exists for these people.
    revalidatePath('/admin/teams')
    return actionSuccess(
      `${id ? 'Team saved' : `${name} added`}. Staffing is ${
        staffingAccess ? 'open to' : 'hidden from'
      } its members.`,
    )
  })
}

export async function setTeamActiveAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withAudit(PERMISSIONS.ADMIN_USERS, async () => {
    const id = formData.get('id')
    const isActive = formData.get('isActive') === 'true'
    if (typeof id !== 'string' || id === '') return actionError('Missing id.')

    const team = await prisma.team.findUnique({
      where: { id },
      select: { name: true, _count: { select: { members: true } } },
    })
    if (!team) return actionError('That team no longer exists.')

    await prisma.team.update({ where: { id }, data: { isActive } })

    revalidatePath('/admin/teams')
    return actionSuccess(
      isActive
        ? `${team.name} reactivated.`
        : `${team.name} deactivated. Its ${team._count.members} member(s) keep their team assignment and their manager keeps visibility of them.`,
    )
  })
}
