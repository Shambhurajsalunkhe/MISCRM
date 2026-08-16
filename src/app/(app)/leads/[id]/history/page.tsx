import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { can } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { ENTITY_TYPE_LABELS } from '@/lib/audit/entities'
import { formatDateTime } from '@/lib/format'
import { COMMON_STAGE_LABELS } from '@/lib/leads/display'
import { Badge } from '@/components/ui/badge'
import { Card, EmptyState } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { loadLead } from '../lead'

type Params = Promise<{ id: string }>

export const metadata = { title: 'History · Sales CRM' }

/**
 * Stage transitions, assignment changes and the audit trail (README §35).
 *
 * Three tables rather than one merged stream, because they answer three
 * different questions. `LeadStageHistory` is what every conversion percentage
 * is computed from (decision D12) and is worth reading on its own; the audit
 * log is the compliance record and is deliberately noisier — it holds every
 * field-level edit, not just the ones that moved the deal.
 */
export default async function LeadHistoryPage({ params }: { params: Params }) {
  const viewer = await requireUser()
  const { id } = await params
  const lead = await loadLead(viewer, id)

  const [stageHistory, assignmentHistory, canSeeAudit] = await Promise.all([
    prisma.leadStageHistory.findMany({
      where: { leadId: lead.id },
      orderBy: { changedAt: 'desc' },
      select: {
        id: true,
        changedAt: true,
        fromCommonStage: true,
        toCommonStage: true,
        hoursInPreviousStage: true,
        note: true,
        fromStage: { select: { name: true } },
        toStage: { select: { name: true } },
        changedBy: { select: { name: true } },
      },
    }),
    prisma.leadAssignmentHistory.findMany({
      where: { leadId: lead.id },
      orderBy: { assignedAt: 'desc' },
      select: {
        id: true,
        assignedAt: true,
        reason: true,
        fromUser: { select: { name: true } },
        toUser: { select: { name: true } },
        assignedBy: { select: { name: true } },
      },
    }),
    can(viewer, PERMISSIONS.ADMIN_AUDIT),
  ])

  // The audit trail is a separate capability from seeing the lead: a BDM works
  // the deal, and Sales Head and Admin read the record of who changed what.
  const auditEntries = canSeeAudit
    ? await prisma.auditLog.findMany({
        where: { entityType: 'LEAD', entityId: lead.id },
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
        description="Every transition this lead has made. This table, not the current stage, is what the funnel and aging reports are computed from."
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
                  <TD className="text-slate-600">
                    {row.fromStage?.name ?? '—'}
                    {row.fromCommonStage ? (
                      <div className="text-xs text-slate-500">
                        {COMMON_STAGE_LABELS[row.fromCommonStage]}
                      </div>
                    ) : null}
                  </TD>
                  <TD>
                    <span className="font-medium text-slate-900">
                      {row.toStage.name}
                    </span>
                    <div className="text-xs text-slate-500">
                      {COMMON_STAGE_LABELS[row.toCommonStage]}
                    </div>
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

      <Card
        title="Assignment history"
        description="Every handover. Who generated the lead never changes — only who works it."
      >
        {assignmentHistory.length === 0 ? (
          <EmptyState>Never assigned.</EmptyState>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>From</TH>
                <TH>To</TH>
                <TH>By</TH>
                <TH>Reason</TH>
              </TR>
            </THead>
            <TBody>
              {assignmentHistory.map((row) => (
                <TR key={row.id}>
                  <TD className="text-slate-600">
                    {formatDateTime(row.assignedAt)}
                  </TD>
                  <TD className="text-slate-600">
                    {row.fromUser?.name ?? 'Unassigned'}
                  </TD>
                  <TD className="font-medium text-slate-900">
                    {row.toUser.name}
                  </TD>
                  <TD className="text-slate-600">{row.assignedBy.name}</TD>
                  <TD className="text-slate-600">{row.reason ?? '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {canSeeAudit ? (
        <Card
          title="Audit trail"
          description={`Every recorded change to ${lead.leadCode}, field by field. The 200 most recent are shown; the full log is at /admin/audit.`}
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
            The field-by-field audit trail for a {ENTITY_TYPE_LABELS.LEAD} is
            visible to Sales Head and Admin.
          </EmptyState>
        </Card>
      )}
    </div>
  )
}
