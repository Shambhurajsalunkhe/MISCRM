import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import { env } from '@/env'
import { auditExtensionArgs } from '@/lib/audit/extension'

/**
 * Prisma 7 connects through a driver adapter rather than reading the URL from
 * the schema. A single client is cached on `globalThis` so Next.js hot reloads
 * don't exhaust the connection pool in development.
 *
 * Two clients exist deliberately:
 *
 *  - `prisma` — the extended client. Use this everywhere. Writes through it are
 *    recorded in `AuditLog` automatically (see src/lib/audit/).
 *  - `prismaBase` — the raw client, given to the audit extension so its own
 *    reads and writes are not themselves audited. Nothing else should import
 *    it; doing so silently opts a write out of the trail.
 */
function createClient() {
  const base = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  })

  return { base, extended: base.$extends(auditExtensionArgs(base)) }
}

const globalForPrisma = globalThis as unknown as {
  prismaClients: ReturnType<typeof createClient> | undefined
}

const clients = globalForPrisma.prismaClients ?? createClient()

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prismaClients = clients
}

export const prisma = clients.extended
export const prismaBase = clients.base
