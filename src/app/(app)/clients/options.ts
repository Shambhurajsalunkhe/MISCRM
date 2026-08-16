import 'server-only'

import { prisma } from '@/lib/db'
import { ROLE_SHORT_LABELS } from '@/lib/roles'

/** Dropdown contents shared by the client create and edit forms. */
export async function loadClientFormOptions() {
  const [countries, owners] = await Promise.all([
    prisma.country.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    }),
  ])

  return {
    countries,
    owners: owners.map((owner) => ({
      id: owner.id,
      name: owner.name,
      roleLabel: ROLE_SHORT_LABELS[owner.role],
    })),
  }
}
