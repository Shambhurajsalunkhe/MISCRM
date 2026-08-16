import { prisma } from '@/lib/db'
import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { ENTITY_TYPE_LABELS } from '@/lib/audit/entities'
import type { AuditAction, EntityType } from '@/generated/prisma/enums'
import { AccessDenied } from '@/components/access-denied'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { ButtonLink } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/field'
import { EmptyState, PageHeader } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'

export const metadata = { title: 'Audit log · Sales CRM' }

const PAGE_SIZE = 50

const ACTIONS: AuditAction[] = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'RESTORE',
  'ASSIGN',
  'REASSIGN',
  'STAGE_CHANGE',
  'WON',
  'LOST',
  'PAYMENT',
  'MERGE',
  'LOGIN',
  'EXPORT',
]

const ACTION_TONES: Partial<Record<AuditAction, BadgeTone>> = {
  CREATE: 'success',
  DELETE: 'danger',
  LOST: 'danger',
  WON: 'success',
  LOGIN: 'info',
  EXPORT: 'warning',
}

function isEntityType(value: string | undefined): value is EntityType {
  return value !== undefined && value in ENTITY_TYPE_LABELS
}

function isAction(value: string | undefined): value is AuditAction {
  return ACTIONS.includes(value as AuditAction)
}

/** A date-only string from `<input type="date">`, or null. */
function parseDate(value: string | undefined): Date | null {
  if (!value) return null
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Midnight at the start of the day after `date`, in the same local zone.
 *
 * Adding 24 hours would be wrong on the two days a year the clocks change: a
 * 23-hour day would cut the last hour off the range, and a 25-hour day would
 * pull in an hour of the next. Stepping the calendar date lets the Date
 * constructor resolve the offset.
 */
function nextLocalMidnight(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 1,
    0,
    0,
    0,
    0,
  )
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    entity?: string
    action?: string
    user?: string
    from?: string
    to?: string
    page?: string
  }>
}) {
  const viewer = await pageAccess(PERMISSIONS.ADMIN_AUDIT)
  if (!viewer) return <AccessDenied what="the audit log" />

  const params = await searchParams
  const page = Math.max(1, Number(params.page ?? '1') || 1)

  const from = parseDate(params.from)
  const to = parseDate(params.to)
  // `to` is inclusive of the whole day the user picked, so push it to midnight
  // the following morning rather than dropping everything after 00:00.
  const toExclusive = to ? nextLocalMidnight(to) : null

  const where = {
    ...(isEntityType(params.entity) ? { entityType: params.entity } : {}),
    ...(isAction(params.action) ? { action: params.action } : {}),
    ...(params.user ? { userId: params.user } : {}),
    ...(from || toExclusive
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(toExclusive ? { lt: toExclusive } : {}),
          },
        }
      : {}),
  }

  const [entries, total, actors] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      select: {
        id: true,
        entityType: true,
        entityId: true,
        action: true,
        fieldName: true,
        oldValue: true,
        newValue: true,
        ipAddress: true,
        createdAt: true,
        user: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    prisma.auditLog.count({ where }),
    // Only people who actually appear in the log, so the filter has no dead
    // options.
    prisma.user.findMany({
      where: { auditLogs: { some: {} } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const queryFor = (overrides: Record<string, string>) => {
    const next = new URLSearchParams()
    for (const [key, value] of Object.entries({ ...params, ...overrides })) {
      if (value) next.set(key, String(value))
    }
    return `/admin/audit?${next.toString()}`
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit log"
        description="Every create, change and deletion, written at the database layer rather than by each screen — so anything that writes is recorded, including work done by later phases."
      />

      <form className="flex flex-wrap items-end gap-2" method="get">
        <div>
          <label htmlFor="entity" className="sr-only">
            Record type
          </label>
          <Select id="entity" name="entity" defaultValue={params.entity ?? ''}>
            <option value="">All record types</option>
            {Object.entries(ENTITY_TYPE_LABELS)
              .sort(([, a], [, b]) => a.localeCompare(b))
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </Select>
        </div>

        <div>
          <label htmlFor="action" className="sr-only">
            Action
          </label>
          <Select id="action" name="action" defaultValue={params.action ?? ''}>
            <option value="">All actions</option>
            {ACTIONS.map((action) => (
              <option key={action} value={action}>
                {action.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label htmlFor="user" className="sr-only">
            User
          </label>
          <Select id="user" name="user" defaultValue={params.user ?? ''}>
            <option value="">Anyone</option>
            {actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label
            htmlFor="from"
            className="block text-xs font-medium text-slate-500"
          >
            From
          </label>
          <Input id="from" name="from" type="date" defaultValue={params.from} />
        </div>

        <div>
          <label
            htmlFor="to"
            className="block text-xs font-medium text-slate-500"
          >
            To
          </label>
          <Input id="to" name="to" type="date" defaultValue={params.to} />
        </div>

        <ButtonLink href="/admin/audit" variant="ghost">
          Clear
        </ButtonLink>
        <button
          type="submit"
          className="h-9 rounded-md border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Apply
        </button>
      </form>

      {entries.length === 0 ? (
        <EmptyState>
          Nothing recorded for these filters yet.
        </EmptyState>
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Who</TH>
                <TH>Record</TH>
                <TH>Action</TH>
                <TH>Change</TH>
              </TR>
            </THead>
            <TBody>
              {entries.map((entry) => (
                <TR key={entry.id}>
                  <TD className="whitespace-nowrap text-slate-600">
                    {/* The year matters here: this table is paginated back
                        through the whole history, so "14 Mar 09:22" is
                        ambiguous the moment the log spans a new year. */}
                    {entry.createdAt.toLocaleString('en-GB', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </TD>
                  <TD>
                    {entry.user ? (
                      <a
                        href={`/admin/users/${entry.user.id}`}
                        className="text-slate-900 hover:underline"
                      >
                        {entry.user.name}
                      </a>
                    ) : (
                      <span
                        className="text-slate-400"
                        title="A write with no signed-in user — the seed script or a background job."
                      >
                        System
                      </span>
                    )}
                    {entry.ipAddress ? (
                      <div className="font-mono text-[11px] text-slate-400">
                        {entry.ipAddress}
                      </div>
                    ) : null}
                  </TD>
                  <TD>
                    <span className="text-slate-700">
                      {ENTITY_TYPE_LABELS[entry.entityType]}
                    </span>
                    <div
                      className="max-w-40 truncate font-mono text-[11px] text-slate-400"
                      title={entry.entityId}
                    >
                      {entry.entityId}
                    </div>
                  </TD>
                  <TD>
                    <Badge tone={ACTION_TONES[entry.action] ?? 'neutral'}>
                      {entry.action.replace(/_/g, ' ').toLowerCase()}
                    </Badge>
                  </TD>
                  <TD className="max-w-md">
                    {entry.fieldName ? (
                      <div className="text-xs">
                        <span className="font-mono text-slate-500">
                          {entry.fieldName}
                        </span>
                        <div className="mt-0.5 break-words">
                          <span className="text-red-700 line-through">
                            {entry.oldValue ?? '(empty)'}
                          </span>
                          <span className="mx-1 text-slate-400">→</span>
                          <span className="text-emerald-700">
                            {entry.newValue ?? '(empty)'}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-slate-500">
                          {entry.action === 'DELETE'
                            ? 'Deleted record'
                            : entry.action === 'CREATE'
                              ? 'Created record'
                              : 'Details'}
                        </summary>
                        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2 text-[11px] text-slate-600">
                          {entry.newValue ?? entry.oldValue ?? '—'}
                        </pre>
                      </details>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              {total} entr{total === 1 ? 'y' : 'ies'} · page {page} of{' '}
              {pageCount}
            </p>
            <div className="flex gap-2">
              {page > 1 ? (
                <ButtonLink
                  href={queryFor({ page: String(page - 1) })}
                  variant="secondary"
                  size="sm"
                >
                  Previous
                </ButtonLink>
              ) : null}
              {page < pageCount ? (
                <ButtonLink
                  href={queryFor({ page: String(page + 1) })}
                  variant="secondary"
                  size="sm"
                >
                  Next
                </ButtonLink>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
