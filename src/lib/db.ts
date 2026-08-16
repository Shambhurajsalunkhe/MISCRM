import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import { env } from '@/env'
import { auditExtensionArgs } from '@/lib/audit/extension'
import { withAuditTransaction } from '@/lib/audit/context'

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

/**
 * The client handed to an `auditedTransaction` body.
 *
 * The extended client minus the methods a transaction cannot host. Derived from
 * `typeof prisma` rather than the generated `Prisma.TransactionClient`, which
 * describes the *unextended* client: the two are structurally the same set of
 * delegates, but Prisma threads its extension arguments through every model
 * type, so the generated alias is not assignable here.
 */
export type TransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

/**
 * An interactive transaction whose audit rows follow the transaction's fate.
 *
 * Use this — never `prisma.$transaction` directly — for anything that writes
 * more than one row and must be all-or-nothing. Issuing a lead code, recording
 * a stage transition and reassigning a lead all qualify: each writes the record
 * and its history together, and a half-applied one is worse than a failure.
 *
 * Two properties a bare `$transaction` does not have:
 *
 *  - Audit rows are held until the transaction commits, so a rollback leaves no
 *    trail of changes that never happened.
 *  - The writer's pre-image reads run inside the transaction, so a row changed
 *    twice in one body is diffed against what the body actually did to it.
 *
 * **Write through the `tx` client the body is given.** A write made on the
 * outer `prisma` from inside here commits independently of the transaction, but
 * its audit row is still buffered — so a rollback would leave the change in
 * place with nothing recorded against it.
 */
export async function auditedTransaction<T>(
  body: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  const rows: unknown[] = []

  const result = await prisma.$transaction((tx) =>
    withAuditTransaction({ client: tx, rows }, () => body(tx)),
  )

  if (rows.length > 0) {
    try {
      await prismaBase.auditLog.createMany({ data: rows as never })
    } catch (error) {
      // Same rule as the extension: the business write has committed, and a
      // failed trail entry must not be reported to the user as a failed save.
      console.error('[audit] failed to flush buffered audit rows', error)
    }
  }

  return result
}
