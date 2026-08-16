import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { can } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { ENTITY_TYPE_LABELS } from '@/lib/audit/entities'
import { formatDateTime } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Card, EmptyState } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { loadRequirement } from '../requirement'

type Params = Promise<{ id: string }>

export const metadata = { title: 'History · Sales CRM' }

/**
 * Stage transitions and the audit trail for one requirement.
 *
 * The requirement equivalent of the lead's History tab, minus the assignment
 * table: `Requirement` carries `assignedToId` but has no assignment-history
 * model, so a handover shows in the audit trail as a field change rather than
 * in a table of its own. That is the schema's decision, not this screen's — a
 * requirement changes hands far less often than a lead.
 */
export default async function RequirementHistoryPage({
  params,
}: {
  params: Params
}) {
  const viewer = await requireUser()
  const { id } = await params
  const requirement = await loadRequirement(viewer, id)

  const [stageHistory, canSeeAudit] = await Promise.all([
    prisma.requirementStageHistory.findMany({
      where: { requirementId: requirement.id },
      orderBy: { changedAt: 'desc' },
      select: {
        id: true,
        changedAt: true,
        hoursInPreviousStage: true,
        note: true,
        fromStage: { select: { name: true } },
        toStage: { select: { name: true } },
        changedBy: { select: { name: true } },
      },
    }),
    can(viewer, PERMISSIONS.ADMIN_AUDIT),
  ])

  const auditEntries = canSeeAudit
    ? await prisma.auditLog.findMany({
        where: { entityType: 'REQUIREMENT', entityId: requirement.id },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          action: true,
          fieldName: true,
          oldValue: true,
          newValue: true,
          createdAt: true,
          user: { select: { name: true } },
        },
      })
    : []

  return (
    <div className="space-y-4">
      <Card
        title="Stage history"
        description="Every transition this requirement has made. This table, not the current stage, is what the staffing funnel and Requirements Filled are computed from."
      >
        {stageHistory.length === 0 ? (
          <EmptyState>No transitions recorded.</EmptyState>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>From</TH>
                <TH>To</TH>
                <TH>Time in previous</TH>
                <TH>By</TH>
                <TH>Note</TH>
              </TR>
            </THead>
            <TBody>
              {stageHistory.map((row) => (
                <TR key={row.id}>
                  <TD className="text-slate-600">
                    {formatDateTime(row.changedAt)}
                  </TD>
                  <TD className="text-slate-600">{row.fromStage?.name ?? '—'}</TD>
                  <TD className="font-medium text-slate-900">
                    {row.toStage.name}
                  </TD>
                  <TD className="text-slate-600">
                    {row.hoursInPreviousStage === null
                      ? '—'
                      : row.hoursInPreviousStage < 24
                        ? `${row.hoursInPreviousStage} h`
                        : `${Math.floor(row.hoursInPreviousStage / 24)} d`}
                  </TD>
                  <TD className="text-slate-600">{row.changedBy.name}</TD>
                  <TD className="text-slate-600">{row.note ?? '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {canSeeAudit ? (
        <Card
          title="Audit trail"
          description={`Every recorded change to ${requirement.requirementCode}, field by field. The 200 most recent are shown; the full log is at /admin/audit.`}
        >
          {auditEntries.length === 0 ? (
            <EmptyState>Nothing recorded.</EmptyState>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Action</TH>
                  <TH>Field</TH>
                  <TH>From</TH>
                  <TH>To</TH>
                  <TH>By</TH>
                </TR>
              </THead>
              <TBody>
                {auditEntries.map((entry) => (
                  <TR key={entry.id}>
                    <TD className="text-slate-600">
                      {formatDateTime(entry.createdAt)}
                    </TD>
                    <TD>
                      <Badge
                        tone={
                          entry.action === 'WON'
                            ? 'success'
                            : entry.action === 'LOST' || entry.action === 'DELETE'
                              ? 'danger'
                              : 'neutral'
                        }
                      >
                        {entry.action}
                      </Badge>
                    </TD>
                    <TD className="text-slate-600">{entry.fieldName ?? '—'}</TD>
                    <TD className="max-w-64 truncate text-slate-600">
                      {entry.oldValue ?? '—'}
                    </TD>
                    <TD className="max-w-64 truncate text-slate-600">
                      {entry.newValue ?? '—'}
                    </TD>
                    <TD className="text-slate-600">
                      {entry.user?.name ?? 'System'}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      ) : (
        <Card title="Audit trail">
          <EmptyState>
            The field-by-field audit trail for a{' '}
            {ENTITY_TYPE_LABELS.REQUIREMENT} is visible to Sales Head and Admin.
          </EmptyState>
        </Card>
      )}
    </div>
  )
}
