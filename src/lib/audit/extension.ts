import 'server-only'

import type { AuditAction, EntityType } from '@/generated/prisma/enums'

import { currentAuditActor, currentAuditTransaction } from '@/lib/audit/context'
import { auditedModel, type AuditedModel } from '@/lib/audit/entities'

/**
 * The audit trail (README §35), written at the ORM layer.
 *
 * Putting this in a Prisma client extension rather than in each server action
 * is the whole point: a new screen added in a later phase is audited the moment
 * it writes, with nothing to remember. The cost is that the writer sees rows,
 * not intent — so a stage change arrives here as "Lead.pipelineStageId changed",
 * and the richer `LeadStageHistory` record stays the job of the stage engine.
 *
 * Three properties this must hold:
 *
 *  1. **It never breaks the write it observes.** Every audit failure is caught
 *     and logged. An unreachable audit table must not stop someone saving a
 *     lead.
 *  2. **It never recurses.** All of its own reads and writes go through the
 *     base client, which has no extension attached.
 *  3. **It records what actually happened**, not what was requested. Updates
 *     are diffed pre-image against the returned row, so a no-op save writes
 *     nothing and a field the caller set to its existing value is not reported
 *     as a change. Inside an interactive transaction that extends to the
 *     transaction's own outcome: rows are buffered and only written once it
 *     commits (see `auditedTransaction` in src/lib/db.ts).
 */

/** Anything with `.findUnique`, `.findMany` and `.create` on each model. */
type ModelDelegate = {
  findUnique: (args: { where: unknown }) => Promise<Record<string, unknown> | null>
  findMany: (args: {
    where?: unknown
    select?: unknown
    take?: number
  }) => Promise<Array<Record<string, unknown>>>
}

type BaseClient = {
  auditLog: {
    createMany: (args: { data: unknown[] }) => Promise<unknown>
  }
} & Record<string, unknown>

export type AuditRow = {
  entityType: EntityType
  entityId: string
  action: AuditAction
  fieldName: string | null
  oldValue: string | null
  newValue: string | null
  userId: string | null
  ipAddress: string | null
  userAgent: string | null
}

/**
 * Bulk operations resolve their target ids up front so each affected row gets
 * its own audit entry. Past this many rows that stops being a useful trail and
 * starts being a denial of service against the audit table, so we record a
 * single summary row instead.
 */
const BULK_ROW_LIMIT = 200

/** Long values are truncated: the audit table is a trail, not a backup. */
const MAX_VALUE_LENGTH = 2_000

function truncate(value: string): string {
  return value.length <= MAX_VALUE_LENGTH
    ? value
    : `${value.slice(0, MAX_VALUE_LENGTH)}… (${value.length} chars)`
}

/**
 * Render a column value as text.
 *
 * Prisma hands back `Decimal` objects and `Date`s, neither of which survives
 * `String()` in a form you would want to read six months later, and `Decimal`
 * in particular stringifies inconsistently across versions.
 */
function serialize(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'object') {
    // Prisma Decimal and similar wrappers expose a faithful toString().
    const maybeDecimal = value as { toFixed?: unknown; toString: () => string }
    if (typeof maybeDecimal.toFixed === 'function') return maybeDecimal.toString()
    try {
      return truncate(JSON.stringify(value))
    } catch {
      return '[unserialisable]'
    }
  }
  return truncate(String(value))
}

/** A whole-row snapshot, for CREATE and DELETE where there is no diff to show. */
function snapshot(
  row: Record<string, unknown>,
  config: AuditedModel,
): string | null {
  const redact = new Set(config.redact ?? [])
  const ignore = new Set(config.ignore ?? [])
  const out: Record<string, string | null> = {}

  for (const [key, value] of Object.entries(row)) {
    if (redact.has(key) || ignore.has(key)) continue
    if (value === null || value === undefined) continue
    // Nested relation payloads belong to their own audit rows.
    if (Array.isArray(value)) continue
    out[key] = serialize(value)
  }

  try {
    return truncate(JSON.stringify(out))
  } catch {
    return null
  }
}

function isPlainRow(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function delegateFor(base: BaseClient, model: string): ModelDelegate | null {
  // Prisma exposes `User` as `prisma.user`. The generated client is typed per
  // model, so reaching it by a runtime string needs a cast; the shape is
  // narrowed to the three methods actually used.
  const key = model.charAt(0).toLowerCase() + model.slice(1)
  const delegate = base[key]
  return isPlainRow(delegate) ? (delegate as unknown as ModelDelegate) : null
}

/** Field-level diff between the row before and after an update. */
function diffRows(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  config: AuditedModel,
): Array<{ fieldName: string; oldValue: string | null; newValue: string | null }> {
  const redact = new Set(config.redact ?? [])
  const ignore = new Set(config.ignore ?? [])
  const changes = []

  for (const key of Object.keys(after)) {
    if (redact.has(key) || ignore.has(key)) continue

    const oldValue = serialize(before[key])
    const newValue = serialize(after[key])
    if (oldValue === newValue) continue

    changes.push({ fieldName: key, oldValue, newValue })
  }

  return changes
}

/**
 * Build the Prisma extension.
 *
 * Takes the base client so its own queries bypass the extension — calling the
 * extended client here would audit the audit write, forever.
 */
export function auditExtensionArgs(client: unknown) {
  // The generated client is typed per model; reaching delegates by a runtime
  // string needs a cast. `BaseClient` narrows it to what is actually used.
  const base = client as BaseClient

  async function persist(rows: AuditRow[]): Promise<void> {
    if (rows.length === 0) return

    // Inside a transaction the write these rows describe has not committed yet
    // and may still roll back, so hold them until it does. The buffer is
    // discarded along with the transaction if it throws — nothing to undo.
    const transaction = currentAuditTransaction()
    if (transaction) {
      transaction.rows.push(...rows)
      return
    }

    try {
      await base.auditLog.createMany({ data: rows })
    } catch (error) {
      // Deliberately swallowed. Property 1 above: the business write has
      // already committed and must not be reported as failed because its
      // audit entry could not be stored.
      console.error('[audit] failed to write audit rows', error)
    }
  }

  function baseRow(
    config: AuditedModel,
    entityId: string,
    action: AuditAction,
  ): AuditRow {
    const actor = currentAuditActor()
    return {
      entityType: config.entityType,
      entityId,
      action,
      fieldName: null,
      oldValue: null,
      newValue: null,
      userId: actor?.userId ?? null,
      ipAddress: actor?.ipAddress ?? null,
      userAgent: actor?.userAgent ?? null,
    }
  }

  function idOf(
    row: Record<string, unknown> | null | undefined,
    config: AuditedModel,
  ): string | null {
    const value = row?.[config.idField]
    return typeof value === 'string' ? value : null
  }

  return {
    name: 'audit-log',
    query: {
      $allModels: {
        async $allOperations({
          model,
          operation,
          args,
          query,
        }: {
          model?: string
          operation: string
          args: Record<string, unknown>
          query: (args: Record<string, unknown>) => Promise<unknown>
        }) {
          const config = auditedModel(model)

          // Reads, raw queries and non-audited models pass straight through.
          // `createMany` is excluded too: it returns only a count, so there are
          // no ids to attribute rows to. No admin screen uses it for an
          // audited model — the seed script does, and that runs with no actor.
          if (
            !config ||
            !model ||
            !['create', 'update', 'upsert', 'delete', 'updateMany', 'deleteMany'].includes(
              operation,
            )
          ) {
            return query(args)
          }

          // Read the pre-image through the transaction when there is one.
          // Reading through `base` would use a different connection, which
          // cannot see uncommitted rows — a lead updated twice inside one
          // transaction would diff its second change against the row as it
          // stood before the first. Reads are not audited, so going back
          // through the extended transaction client does not recurse.
          const transaction = currentAuditTransaction()
          const delegate = delegateFor(
            (transaction?.client as BaseClient | undefined) ?? base,
            model,
          )

          // --- Pre-image ------------------------------------------------------
          // Read before the write, because after a delete there is nothing left
          // to read, and after an update the old values are gone.
          let before: Record<string, unknown> | null = null
          let bulkTargets: Array<Record<string, unknown>> = []

          try {
            if (delegate && ['update', 'upsert', 'delete'].includes(operation)) {
              before = await delegate.findUnique({ where: args.where })
            } else if (delegate && ['updateMany', 'deleteMany'].includes(operation)) {
              bulkTargets = await delegate.findMany({
                where: args.where,
                take: BULK_ROW_LIMIT + 1,
              })
            }
          } catch (error) {
            console.error('[audit] failed to read pre-image', model, error)
          }

          // --- The actual write ------------------------------------------------
          const result = await query(args)

          // --- Record it -------------------------------------------------------
          try {
            const rows: AuditRow[] = []

            if (operation === 'create' && isPlainRow(result)) {
              const id = idOf(result, config)
              if (id) {
                rows.push({
                  ...baseRow(config, id, 'CREATE'),
                  newValue: snapshot(result, config),
                })
              }
            } else if (operation === 'delete') {
              const id = idOf(before, config) ?? idOf(result as Record<string, unknown>, config)
              if (id) {
                rows.push({
                  ...baseRow(config, id, 'DELETE'),
                  oldValue: before ? snapshot(before, config) : null,
                })
              }
            } else if (
              (operation === 'update' || operation === 'upsert') &&
              isPlainRow(result)
            ) {
              const id = idOf(result, config)
              if (id && !before && operation === 'upsert') {
                // An upsert that took the create branch.
                //
                // Restricted to `upsert` deliberately: a plain `update` with no
                // pre-image means the read failed, not that the row is new.
                // Logging that as a CREATE would invent a record lifecycle that
                // never happened.
                rows.push({
                  ...baseRow(config, id, 'CREATE'),
                  newValue: snapshot(result, config),
                })
              } else if (id && !before) {
                console.error(
                  '[audit] update with no pre-image; recording without a diff',
                  model,
                )
                rows.push({
                  ...baseRow(config, id, 'UPDATE'),
                  newValue: snapshot(result, config),
                })
              } else if (id && before) {
                for (const change of diffRows(before, result, config)) {
                  rows.push({ ...baseRow(config, id, 'UPDATE'), ...change })
                }
              }
            } else if (operation === 'updateMany' || operation === 'deleteMany') {
              const action: AuditAction =
                operation === 'deleteMany' ? 'DELETE' : 'UPDATE'

              if (bulkTargets.length > BULK_ROW_LIMIT) {
                // Above the limit, one summary row. `entityId` has to hold
                // something, and the where-clause is the only honest answer.
                rows.push({
                  ...baseRow(config, 'bulk', action),
                  fieldName: '(bulk)',
                  newValue: truncate(
                    `${operation} matched more than ${BULK_ROW_LIMIT} rows; where=${JSON.stringify(args.where ?? {})}`,
                  ),
                })
              } else {
                for (const target of bulkTargets) {
                  const id = idOf(target, config)
                  if (!id) continue
                  rows.push({
                    ...baseRow(config, id, action),
                    fieldName: '(bulk)',
                    oldValue: snapshot(target, config),
                  })
                }
              }
            }

            await persist(rows)
          } catch (error) {
            console.error('[audit] failed to record', model, operation, error)
          }

          return result
        },
      },
    },
  }
}
