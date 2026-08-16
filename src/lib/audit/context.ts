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
 * The interactive transaction currently in progress, if any.
 *
 * Two things go wrong when the audit writer ignores transactions, and Phase 2
 * hits both — issuing a lead code and writing stage history are transactional:
 *
 *  1. Its pre-image read goes through a connection outside the transaction, so
 *     it cannot see rows the transaction has already changed. The diff would be
 *     computed against a stale row.
 *  2. Its audit rows are written immediately, so a rollback leaves behind a
 *     trail of changes that never happened.
 *
 * Holding the transaction client and a row buffer here fixes both without any
 * call site passing them: the extension reads pre-images through `client`, and
 * appends to `rows` instead of inserting. `auditedTransaction` in
 * `src/lib/db.ts` flushes the buffer only once the transaction has committed.
 */
export type AuditTransaction = {
  /** The transaction client, used for pre-image reads. */
  client: unknown
  /** Rows held until commit. */
  rows: unknown[]
}

const transactionStorage = new AsyncLocalStorage<AuditTransaction>()

/**
 * Run `fn` with every audit row it produces buffered rather than written.
 *
 * Called by `auditedTransaction`; there is no reason to call it directly. Any
 * write made inside must go through the transaction client that was passed in,
 * not the module-level `prisma` — a write on the outer client commits on its
 * own, and its audit row would then be discarded if the transaction rolls back.
 */
export function withAuditTransaction<T>(
  scope: AuditTransaction,
  fn: () => Promise<T>,
): Promise<T> {
  return transactionStorage.run(scope, fn)
}

/** The transaction in progress on this async stack, or `null`. */
export function currentAuditTransaction(): AuditTransaction | null {
  return transactionStorage.getStore() ?? null
}

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
