import 'server-only'

import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Who is responsible for the writes happening right now.
 *
 * The audit writer lives in a Prisma client extension (`./extension.ts`), which
 * sees the query but has no idea which request produced it. Threading an actor
 * argument through every call site would be both noisy and easy to forget —
 * and a forgotten one produces an audit row that silently blames nobody.
 *
 * `AsyncLocalStorage` keeps the actor on the async call stack instead, so any
 * write made anywhere beneath `withAuditActor` is attributed automatically.
 */
export type AuditActor = {
  userId: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

const storage = new AsyncLocalStorage<AuditActor>()

/**
 * Run `fn` with `actor` attributed to every database write it performs.
 *
 * Server actions go through `withAudit` in `src/lib/action.ts`, which calls
 * this for you. Reach for it directly only in background jobs and scripts.
 */
export function withAuditActor<T>(
  actor: AuditActor,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(actor, fn)
}

/**
 * The actor for the current async context, or `null` outside one — the seed
 * script and migrations write with no actor, and `AuditLog.userId` is nullable
 * precisely so those rows are still recorded rather than dropped.
 */
export function currentAuditActor(): AuditActor | null {
  return storage.getStore() ?? null
}
