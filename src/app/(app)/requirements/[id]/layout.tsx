import { can } from '@/lib/authz'
import { requireUser } from '@/lib/auth/session'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { formatAge, formatDate, formatMoney } from '@/lib/format'
import { PRIORITY_LABELS, PRIORITY_TONES } from '@/lib/leads/display'
import {
  fillLabel,
  REQUIREMENT_STATUS_LABELS,
  REQUIREMENT_STATUS_TONES,
} from '@/lib/staffing/display'
import { AccessDenied } from '@/components/access-denied'
import { Badge } from '@/components/ui/badge'
import { ButtonLink } from '@/components/ui/button'
import { LinkTabs } from '@/components/ui/tabs'
import { lostReasonOptions, requirementStageOptions } from '../options'
import { loadRequirement } from './requirement'
import { RequirementStageControl } from './stage-control'
import { RequirementStatusControl } from './status-control'

type Params = Promise<{ id: string }>

/**
 * The requirement detail shell (docs/03-screens-and-roles.md §1).
 *
 * The header carries what a recruiter checks before doing anything else — how
 * many openings are left, how long it has sat, and whether the client has put
 * it on hold — and the tabs below are each a small server component fetching
 * only their own rows. `loadRequirement` is request-cached, so the header costs
 * one query whichever tab is open.
 */
export default async function RequirementLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Params
}) {
  const viewer = await requireUser()
  if (!(await can(viewer, PERMISSIONS.STAFFING_CANDIDATE_MANAGE))) {
    return <AccessDenied what="staffing requirements" />
  }

  const { id } = await params
  const requirement = await loadRequirement(viewer, id)

  // Working the submission board needs only the candidate permission; changing
  // the requirement itself needs the requirement one. docs/03 §2 gives a BDE
  // the first and not the second.
  const [canManage, symbol] = await Promise.all([
    can(viewer, PERMISSIONS.STAFFING_REQUIREMENT_MANAGE),
    currencySymbol(),
  ])

  const [stages, lostReasons] = await Promise.all([
    canManage ? requirementStageOptions() : Promise.resolve([]),
    canManage
      ? lostReasonOptions(requirement.lead.verticalId)
      : Promise.resolve([]),
  ])

  const base = `/requirements/${requirement.id}`
  const closed =
    requirement.status === 'FILLED' ||
    requirement.status === 'LOST' ||
    requirement.status === 'CANCELLED'

  const threshold = requirement.currentStage?.agingThresholdDays
  const days = Math.floor(
    (Date.now() - requirement.stageChangedAt.getTime()) / 86_400_000,
  )
  const overdue = !closed && threshold != null && days > threshold

  return (
    <div className="space-y-5">
      <header className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-900">
                {requirement.requirementCode}
              </h1>
              <Badge tone={REQUIREMENT_STATUS_TONES[requirement.status]}>
                {REQUIREMENT_STATUS_LABELS[requirement.status]}
              </Badge>
              {requirement.priority === 'MEDIUM' ||
              requirement.priority === 'LOW' ? null : (
                <Badge tone={PRIORITY_TONES[requirement.priority]}>
                  {PRIORITY_LABELS[requirement.priority]}
                </Badge>
              )}
              {requirement.requirementType ? (
                <Badge tone="info">{requirement.requirementType.name}</Badge>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-slate-700">
              {requirement.position}
              {requirement.location ? ` · ${requirement.location}` : ''}
              {requirement.workMode ? ` · ${requirement.workMode}` : ''}
            </p>
            <p className="mt-0.5 text-sm text-slate-500">
              <a
                href={`/clients/${requirement.client.id}`}
                className="hover:underline"
              >
                {requirement.client.companyName}
              </a>
              {' · '}
              <a href={`/leads/${requirement.lead.id}`} className="hover:underline">
                {requirement.lead.leadCode}
              </a>
            </p>
          </div>

          {canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <ButtonLink href={`${base}/edit`} variant="secondary" size="sm">
                Edit
              </ButtonLink>
              {closed ? null : (
                <RequirementStatusControl
                  requirementId={requirement.id}
                  status={requirement.status}
                />
              )}
              <RequirementStageControl
                requirementId={requirement.id}
                stages={stages}
                currentStageId={requirement.currentStageId}
                currentSortOrder={requirement.currentStage?.sortOrder ?? null}
                lostReasons={lostReasons}
              />
            </div>
          ) : null}
        </div>

        <dl className="grid gap-3 border-t border-slate-100 pt-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <HeaderFact
            label="Openings"
            value={fillLabel(requirement.openings, requirement.positionsFilled)}
            hint={
              requirement.positionsFilled > 0
                ? `${requirement._count.placements} placement${requirement._count.placements === 1 ? '' : 's'} recorded`
                : 'No placements yet'
            }
          />
          <HeaderFact
            label="Stage"
            value={requirement.currentStage?.name ?? 'Not set'}
            hint={`${formatAge(requirement.stageChangedAt)} in stage`}
            tone={overdue ? 'alert' : 'default'}
          />
          <HeaderFact
            label="Owner"
            value={requirement.assignedTo?.name ?? 'Unassigned'}
          />
          <HeaderFact
            label="Budget"
            value={
              requirement.budgetMin || requirement.budgetMax
                ? `${formatMoney(requirement.budgetMin, symbol)} – ${formatMoney(requirement.budgetMax, symbol)}`
                : '—'
            }
            hint={
              requirement.targetDate
                ? `Target ${formatDate(requirement.targetDate)}`
                : undefined
            }
          />
        </dl>

        {overdue ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {days} days at {requirement.currentStage?.name}, past this stage&rsquo;s
            {' '}
            {threshold}-day threshold.
          </p>
        ) : null}

        {requirement.status === 'LOST' && requirement.lostReason ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Lost — {requirement.lostReason.name}
            {requirement.closedAt ? ` (${formatDate(requirement.closedAt)})` : ''}
          </p>
        ) : null}
      </header>

      <LinkTabs
        tabs={[
          {
            label: 'Submissions',
            href: base,
            exact: true,
            count: requirement._count.submissions,
          },
          {
            label: 'Timeline',
            href: `${base}/timeline`,
            count: requirement._count.activities,
          },
          {
            label: 'Documents',
            href: `${base}/documents`,
            count: requirement._count.documents,
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
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'alert'
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd
        className={
          tone === 'alert'
            ? 'font-medium text-amber-700'
            : 'font-medium text-slate-900'
        }
      >
        {value}
      </dd>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  )
}
