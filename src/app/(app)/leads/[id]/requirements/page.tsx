import { prisma } from '@/lib/db'
import { can } from '@/lib/authz'
import { requireUser } from '@/lib/auth/session'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { requirementVisibilityFilter } from '@/lib/visibility'
import { formatAge, formatDate, formatMoney } from '@/lib/format'
import { PRIORITY_LABELS, PRIORITY_TONES } from '@/lib/leads/display'
import {
  fillLabel,
  REQUIREMENT_STATUS_LABELS,
  REQUIREMENT_STATUS_TONES,
} from '@/lib/staffing/display'
import { Badge } from '@/components/ui/badge'
import { ButtonLink } from '@/components/ui/button'
import { Card, EmptyState } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { loadLead } from '../lead'

type Params = Promise<{ id: string }>

export const metadata = { title: 'Requirements · Sales CRM' }

/**
 * The Staffing-only tab of the lead detail screen (docs/03 §1).
 *
 * This is where README §13's rule becomes visible: *"the CRM should not create
 * a completely separate client record every time the same client raises another
 * requirement."* One lead, several `REQ-` rows, each with its own stage, its own
 * openings and its own outcome — and the lead's Won/Lost derived from them
 * rather than typed (decision D8), which the note at the foot of this tab says
 * in as many words, because it is surprising the first time somebody notices
 * the lead's stage control will not mark a staffing lead Won.
 *
 * The requirements are re-queried through `requirementVisibilityFilter` rather
 * than read off the lead. Seeing a lead and being in scope for every
 * requirement under it are not the same thing — a role handed to another team's
 * recruiter is theirs, and this tab says how many are hidden rather than
 * pretending they do not exist.
 */
export default async function LeadRequirementsPage({
  params,
}: {
  params: Params
}) {
  const viewer = await requireUser()
  const { id } = await params
  const lead = await loadLead(viewer, id)

  const [requirements, total, symbol, canManage] = await Promise.all([
    prisma.requirement.findMany({
      where: {
        leadId: lead.id,
        isDeleted: false,
        ...(await requirementVisibilityFilter(viewer)),
      },
      select: {
        id: true,
        requirementCode: true,
        position: true,
        openings: true,
        positionsFilled: true,
        status: true,
        priority: true,
        location: true,
        targetDate: true,
        stageChangedAt: true,
        budgetMax: true,
        currentStage: { select: { name: true } },
        assignedTo: { select: { name: true } },
        _count: { select: { submissions: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.requirement.count({ where: { leadId: lead.id, isDeleted: false } }),
    currencySymbol(),
    can(viewer, PERMISSIONS.STAFFING_REQUIREMENT_MANAGE),
  ])

  const hidden = total - requirements.length

  if (!lead.vertical.usesRequirements) {
    return (
      <Card title="Requirements">
        <EmptyState>
          {lead.vertical.name} leads do not carry requirements. The module is a
          switch on the vertical in Master Data, so this tab appears wherever it
          is turned on.
        </EmptyState>
      </Card>
    )
  }

  return (
    <Card
      title="Requirements"
      description="Every role this client has asked you to fill under this engagement. Each carries its own stage list and its own outcome."
      actions={
        canManage ? (
          <ButtonLink href={`/requirements/new?lead=${lead.id}`} size="sm">
            New requirement
          </ButtonLink>
        ) : null
      }
    >
      {requirements.length === 0 ? (
        <EmptyState>
          {hidden > 0
            ? `${hidden} requirement${hidden === 1 ? '' : 's'} on this lead ${hidden === 1 ? 'is' : 'are'} outside your scope.`
            : 'No requirements raised yet. Add the first role the client asked for.'}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          <Table>
            <THead>
              <TR>
                <TH>Requirement</TH>
                <TH>Stage</TH>
                <TH className="text-right">Openings</TH>
                <TH className="text-right">Profiles</TH>
                <TH className="text-right">Budget</TH>
                <TH>Target</TH>
                <TH>In stage</TH>
                <TH>Owner</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {requirements.map((requirement) => (
                <TR key={requirement.id}>
                  <TD>
                    <a
                      href={`/requirements/${requirement.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {requirement.requirementCode}
                    </a>
                    <div className="max-w-64 truncate text-xs text-slate-500">
                      {requirement.position}
                      {requirement.location ? ` · ${requirement.location}` : ''}
                    </div>
                  </TD>
                  <TD className="text-slate-600">
                    {requirement.currentStage?.name ?? '—'}
                  </TD>
                  <TD className="text-right tabular-nums text-slate-600">
                    {fillLabel(requirement.openings, requirement.positionsFilled)}
                  </TD>
                  <TD className="text-right tabular-nums text-slate-600">
                    {requirement._count.submissions}
                  </TD>
                  <TD className="text-right text-slate-600">
                    {formatMoney(requirement.budgetMax, symbol)}
                  </TD>
                  <TD className="text-slate-600">
                    {formatDate(requirement.targetDate)}
                  </TD>
                  <TD className="text-slate-600">
                    {formatAge(requirement.stageChangedAt)}
                  </TD>
                  <TD className="text-slate-600">
                    {requirement.assignedTo?.name ?? 'Unassigned'}
                  </TD>
                  <TD>
                    <div className="flex flex-col items-start gap-1">
                      <Badge tone={REQUIREMENT_STATUS_TONES[requirement.status]}>
                        {REQUIREMENT_STATUS_LABELS[requirement.status]}
                      </Badge>
                      {requirement.priority === 'MEDIUM' ||
                      requirement.priority === 'LOW' ? null : (
                        <Badge tone={PRIORITY_TONES[requirement.priority]}>
                          {PRIORITY_LABELS[requirement.priority]}
                        </Badge>
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>

          {hidden > 0 ? (
            <p className="text-xs text-slate-500">
              {hidden} further requirement{hidden === 1 ? '' : 's'} on this lead{' '}
              {hidden === 1 ? 'is' : 'are'} outside your scope.
            </p>
          ) : null}

          <p className="text-xs text-slate-500">
            This lead&rsquo;s Won / Lost is derived from these rows, never typed:
            Won once any requirement is filled, Lost when every one of them is
            lost. It still counts as one lead — requirement outcomes are reported
            separately, so two filled roles are not two won deals.
          </p>
        </div>
      )}
    </Card>
  )
}
