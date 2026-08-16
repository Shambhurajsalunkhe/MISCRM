import 'server-only'

import { prisma } from '@/lib/db'
import { MANAGERIAL_ROLES } from '@/lib/roles'
import type { UserFormOptions } from './user-form'

/** The dropdown contents shared by the create and edit forms. */
export async function loadUserFormOptions(): Promise<UserFormOptions> {
  const [departments, teams, managers] = await Promise.all([
    prisma.department.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.team.findMany({
      where: { isActive: true },
      select: { id: true, name: true, department: { select: { name: true } } },
      orderBy: { name: 'asc' },
    }),
    // Only active people, and only roles that can actually hold reports — a
    // chain that runs through a deactivated user would leave everyone beneath
    // them invisible to their real manager.
    prisma.user.findMany({
      where: { isActive: true, role: { in: MANAGERIAL_ROLES } },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    }),
  ])

  return {
    departments,
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      departmentName: team.department?.name ?? null,
    })),
    managers,
  }
}
