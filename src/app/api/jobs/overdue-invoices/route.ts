import { timingSafeEqual } from 'node:crypto'

import { env } from '@/env'
import { getCurrentUser } from '@/lib/auth/session'
import { can } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { recordAudit } from '@/lib/audit/record'
import { sweepOverdueInvoices } from '@/lib/commercials/overdue'

/**
 * The nightly overdue sweep (docs/01-data-model.md §3).
 *
 * An endpoint rather than an in-process schedule, for the reasons set out in
 * `src/lib/commercials/overdue.ts`: the plan puts node-cron in Phase 7 with the
 * follow-up and aging jobs, and the hosting decision (Q7) is what determines
 * whether a process-resident timer can run at all. Anything that can make an
 * HTTP call on a schedule works today, and Phase 7 can call the same function
 * in-process without this route changing.
 *
 * Two callers are accepted:
 *
 *  - a scheduler presenting `Authorization: Bearer <CRON_SECRET>`;
 *  - a signed-in administrator, which is what the button on the invoice
 *    register uses.
 *
 * `POST` only. A sweep is a write, and a `GET` that changes rows is one
 * link-preview crawler away from running unbidden.
 */
export async function POST(request: Request) {
  const authorised = (await hasCronSecret(request)) || (await isAdministrator())

  if (!authorised) {
    return Response.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const result = await sweepOverdueInvoices()

  // Worth a trail entry: this job moves invoices between statuses with no user
  // behind the change, so without it a chip that flipped overnight has nothing
  // explaining it. `entityId` is the job rather than a row — one line per run,
  // not one per invoice, which would bury the log on the first month-end.
  await recordAudit({
    entityType: 'INVOICE',
    entityId: 'overdue-sweep',
    action: 'UPDATE',
    fieldName: 'status',
    newValue: `${result.markedOverdue} marked overdue, ${result.clearedOverdue} cleared`,
    userId: null,
  })

  return Response.json(result)
}

async function hasCronSecret(request: Request): Promise<boolean> {
  const secret = env.CRON_SECRET
  if (!secret) return false

  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return false

  // Constant-time, and length-guarded first because `timingSafeEqual` throws on
  // mismatched lengths rather than returning false.
  const presented = Buffer.from(header.slice('Bearer '.length))
  const expected = Buffer.from(secret)

  return (
    presented.length === expected.length && timingSafeEqual(presented, expected)
  )
}

async function isAdministrator(): Promise<boolean> {
  const user = await getCurrentUser()
  return user ? can(user, PERMISSIONS.ADMIN_MASTER) : false
}
