import { prisma } from '@/lib/db'
import { can } from '@/lib/authz'
import { requireUser } from '@/lib/auth/session'
import { PERMISSIONS } from '@/lib/permissions'
import { ROLE_SHORT_LABELS } from '@/lib/roles'
import { currencySymbol } from '@/lib/settings'
import { formatAge, formatDate, formatMoney } from '@/lib/format'
import {
  COMMON_STAGE_LABELS,
  LEAD_STATUS_LABELS,
  LEAD_STATUS_TONES,
  PRIORITY_LABELS,
  PRIORITY_TONES,
} from '@/lib/leads/display'
import { AccessDenied } from '@/components/access-denied'
import { Badge } from '@/components/ui/badge'
import { ButtonLink } from '@/components/ui/button'
import { LinkTabs } from '@/components/ui/tabs'
import { loadLead } from './lead'
import { AssignControl } from './assign-control'
import { StageControl } from './stage-control'

type Params = Promise<{ id: string }>

/**
 * The lead detail shell (docs/03-screens-and-roles.md §1).
 *
 * The header and the tab strip live here so each tab is free to be a small
 * server component that fetches only its own rows. `loadLead` is request-cached,
 * so the header costs one query no matter which tab is open.
 */
export default async function LeadLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Params
}) {
  const viewer = await requireUser()
  if (!(await can(viewer, PERMISSIONS.LEAD_VIEW))) {
    return <AccessDenied what="leads" />
  }

  const { id } = await params
  const lead = await loadLead(viewer, id)

  const [canEdit, canChangeStage, canAssign, canSetOutcome, symbol] =
    await Promise.all([
      can(viewer, PERMISSIONS.LEAD_EDIT),
      can(viewer, PERMISSIONS.LEAD_STAGE_CHANGE),
      can(viewer, PERMISSIONS.LEAD_ASSIGN),
      can(viewer, PERMISSIONS.LEAD_COMMERCIAL),
      currencySymbol(),
    ])

  // Only fetch what the controls need, and only if they will be rendered.
  const [stages, lostReasons, assignees] = await Promise.all([
    canChangeStage
      ? prisma.pipelineStage.findMany({
          where: { verticalId: lead.vertical.id, isActive: true },
          select: {
            id: true,
            name: true,
            sortOrder: true,
            isWon: true,
            isLost: true,
          },
          orderBy: { sortOrder: 'asc' },
        })
      : Promise.resolve([]),
    canChangeStage
      ? prisma.lostReason.findMany({
          // Global reasons plus this vertical's own.
          where: {
            isActive: true,
            OR: [{ verticalId: null }, { verticalId: lead.vertical.id }],
          },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
    canAssign
      ? prisma.user.findMany({
          where: { isActive: true },
          select: { id: true, name: true, role: true },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
  ])

  const base = `/leads/${lead.id}`

  return (
    <div className="space-y-5">
      <header className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-900">
                {lead.leadCode}
              </h1>
              <Badge tone="info">{lead.vertical.name}</Badge>
              <Badge tone={LEAD_STATUS_TONES[lead.status]}>
                {LEAD_STATUS_LABELS[lead.status]}
              </Badge>
              {lead.priority === 'MEDIUM' || lead.priority === 'LOW' ? null : (
                <Badge tone={PRIORITY_TONES[lead.priority]}>
                  {PRIORITY_LABELS[lead.priority]}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-700">{lead.title}</p>
            <p className="mt-0.5 text-sm text-slate-500">
              <a
                href={`/clients/${lead.client.id}`}
                className="hover:underline"
              >
                {lead.client.companyName}
              </a>
              {lead.primaryContact ? ` · ${lead.primaryContact.name}` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <ButtonLink href={`${base}/edit`} variant="secondary" size="sm">
                Edit
              </ButtonLink>
            ) : null}
            {canAssign ? (
              <AssignControl
                leadId={lead.id}
                users={assignees.map((user) => ({
                  id: user.id,
                  name: user.name,
                  roleLabel: ROLE_SHORT_LABELS[user.role],
                }))}
                currentAssigneeId={lead.assignedTo?.id ?? null}
              />
            ) : null}
            {canChangeStage ? (
              <StageControl
                leadId={lead.id}
                stages={stages}
                currentStageId={lead.currentStageId}
                currentSortOrder={lead.currentStage?.sortOrder ?? null}
                lostReasons={lostReasons}
                currencySymbol={symbol}
                dealValue={lead.dealValue?.toString() ?? null}
                canSetOutcome={canSetOutcome}
              />
            ) : null}
          </div>
        </div>

        {/* Generated By and Assigned To side by side, as the screen inventory
            specifies — the two are different people doing different jobs, and
            the header is where that has to be obvious. */}
        <dl className="grid gap-3 border-t border-slate-100 pt-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <HeaderFact label="Generated by" value={lead.generatedBy.name} />
          <HeaderFact
            label="Assigned to"
            value={lead.assignedTo?.name ?? 'Unassigned'}
          />
          <HeaderFact
            label="Stage"
            value={lead.currentStage?.name ?? 'Not set'}
            hint={`${COMMON_STAGE_LABELS[lead.commonStage]} · ${formatAge(lead.stageChangedAt)} in stage`}
          />
          <HeaderFact
            label={lead.status === 'WON' ? 'Deal value' : 'Value'}
            value={formatMoney(lead.dealValue ?? lead.expectedBudget, symbol)}
            hint={
              lead.dealValue
                ? 'Agreed'
                : lead.expectedBudget
                  ? 'Expected budget'
                  : undefined
            }
          />
        </dl>

        {lead.status === 'LOST' && lead.lostReason ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Lost — {lead.lostReason.name}
            {lead.lostNotes ? `: ${lead.lostNotes}` : ''}
            {lead.closedAt ? ` (${formatDate(lead.closedAt)})` : ''}
          </p>
        ) : null}
      </header>

      <LinkTabs
        tabs={[
          { label: 'Overview', href: base, exact: true },
          {
            label: 'Timeline',
            href: `${base}/timeline`,
            count: lead._count.activities,
          },
          {
            label: 'Documents',
            href: `${base}/documents`,
            count: lead._count.documents,
          },
          { label: 'History', href: `${base}/history` },
        ]}
      />

      {children}
    </div>
  )
}

function HeaderFact({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  )
}
