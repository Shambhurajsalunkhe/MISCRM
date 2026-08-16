import 'server-only'

import { headers } from 'next/headers'

import type { AuditAction, EntityType } from '@/generated/prisma/enums'
import { prismaBase } from '@/lib/db'

/**
 * Record an event the ORM extension cannot see.
 *
 * The extension in `./extension.ts` observes row changes, which covers CREATE,
 * UPDATE and DELETE for free. It cannot see events that are not row changes —
 * a sign-in, an export — nor can it tell a plain `assignedToId` update apart
 * from a deliberate reassignment. Those get an explicit call here.
 *
 * Uses the base client on purpose: writing through the extended one would
 * audit the audit row.
 */
export async function recordAudit(entry: {
  entityType: EntityType
  entityId: string
  action: AuditAction
  fieldName?: string | null
  oldValue?: string | null
  newValue?: string | null
  userId: string | null
}): Promise<void> {
  // Request metadata is optional. `headers()` throws outside a request scope —
  // a background job, a script — and losing the IP is not a reason to lose the
  // record of a sign-in, so the lookup is failed separately from the insert.
  let ipAddress: string | null = null
  let userAgent: string | null = null

  try {
    const headerList = await headers()
    ipAddress =
      headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      headerList.get('x-real-ip')
    userAgent = headerList.get('user-agent')
  } catch {
    // No request context; the entry is still worth writing without them.
  }

  try {
    await prismaBase.auditLog.create({
      data: {
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        fieldName: entry.fieldName ?? null,
        oldValue: entry.oldValue ?? null,
        newValue: entry.newValue ?? null,
        userId: entry.userId,
        ipAddress,
        userAgent,
      },
    })
  } catch (error) {
    // Same rule as the extension: never fail the operation being audited.
    console.error('[audit] failed to record explicit event', entry.action, error)
  }
}
