import { prisma } from '@/lib/db'
import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { requirementVisibilityFilter } from '@/lib/visibility'
import { formatAge, formatDate, formatMoney } from '@/lib/format'
import { PRIORITY_LABELS, PRIORITY_ORDER, PRIORITY_TONES } from '@/lib/leads/display'
import {
  fillLabel,
  REQUIREMENT_STATUS_LABELS,
  REQUIREMENT_STATUS_ORDER,
  REQUIREMENT_STATUS_TONES,
} from '@/lib/staffing/display'
import { AccessDenied } from '@/components/access-denied'
import { Badge } from '@/components/ui/badge'
import { ButtonLink } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/field'
import { EmptyState, PageHeader } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  pickRequirementFilters,
  requirementFilterQuery,
  requirementWhere,
} from './filters'
import {
  activeUserOptions,
  requirementStageOptions,
  requirementTypeOptions,
} from './options'

export const metadata = { title: 'Requirements · Sales CRM' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** Same reasoning as the lead and client lists: filters narrow, not pages. */
const PAGE_SIZE = 100

export default async function RequirementsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.STAFFING_REQUIREMENT_MANAGE)
  if (!viewer) return <AccessDenied what="staffing requirements" />

  const filters = pickRequirementFilters(await searchParams)
  const query = requirementFilterQuery(filters)
  const now = new Date()
  const where = await requirementWhere(viewer, filters, now)
  const visibleRequirements = await requirementVisibilityFilter(viewer)

  const [requirements, total, stages, types, people, clients, symbol] =
    await Promise.all([
      prisma.requirement.findMany({
        where,
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
          budgetMin: true,
          budgetMax: true,
          client: { select: { id: true, companyName: true } },
          lead: { select: { id: true, leadCode: true } },
          currentStage: { select: { name: true, agingThresholdDays: true } },
          assignedTo: { select: { name: true } },
          _count: { select: { submissions: true } },
        },
        // `desc` on priority, because the enum is declared LOW→URGENT and
        // Postgres orders enums by declaration. Urgent roles belong at the top
        // of a list whose job is "what do I have to fill".
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        take: PAGE_SIZE,
      }),
      prisma.requirement.count({ where }),
      requirementStageOptions(),
      requirementTypeOptions(),
      activeUserOptions(),
      // Only clients that actually have a requirement *this viewer can see*.
      // The scope belongs inside the `some`, not just on the list itself: a
      // picker built from every client with any requirement would name accounts
      // whose roles all sit outside the viewer's scope, and a filter dropdown
      // that lists a company is as much a disclosure as a row would be.
      prisma.client.findMany({
        where: {
          isDeleted: false,
          requirements: { some: { isDeleted: false, ...visibleRequirements } },
        },
        select: { id: true, companyName: true },
        orderBy: { companyName: 'asc' },
      }),
      currencySymbol(),
    ])

  return (
    <div className="space-y-5">
      <PageHeader
        title="Requirements"
        description="Every staffing role raised under a client engagement, with its openings, ageing and submission count."
        // No permission check on the button: reaching this page at all means
        // holding `staffing.requirement.manage`, which is the same capability
        // the create action demands.
        actions={<ButtonLink href="/requirements/new">New requirement</ButtonLink>}
      />

      <form className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6" method="get">
        <div className="sm:col-span-3 lg:col-span-2">
          <label htmlFor="q" className="sr-only">
            Search requirements
          </label>
          <Input
            id="q"
            name="q"
            defaultValue={filters.q ?? ''}
            placeholder="Code, position, skill or company"
          />
        </div>

        <FilterSelect
          id="status"
          label="Status"
          value={filters.status}
          blank="Live requirements"
          options={[
            { value: 'all', label: 'Every status' },
            ...REQUIREMENT_STATUS_ORDER.map((status) => ({
              value: status,
              label: REQUIREMENT_STATUS_LABELS[status],
            })),
          ]}
        />

        <FilterSelect
          id="stage"
          label="Stage"
          value={filters.stage}
          blank="All stages"
          options={stages.map((stage) => ({ value: stage.id, label: stage.name }))}
        />

        <FilterSelect
          id="client"
          label="Client"
          value={filters.client}
          blank="All clients"
          options={clients.map((client) => ({
            value: client.id,
            label: client.companyName,
          }))}
        />

        <FilterSelect
          id="owner"
          label="Owner"
          value={filters.owner}
          blank="Anyone"
          options={people.map((person) => ({
            value: person.id,
            label: person.name,
          }))}
        />

        <FilterSelect
          id="type"
          label="Type"
          value={filters.type}
          blank="All types"
          options={types.map((type) => ({ value: type.id, label: type.name }))}
        />

        <FilterSelect
          id="priority"
          label="Priority"
          value={filters.priority}
          blank="Any priority"
          options={PRIORITY_ORDER.map((priority) => ({
            value: priority,
            label: PRIORITY_LABELS[priority],
          }))}
        />

        <FilterSelect
          id="aging"
          label="Ageing"
          value={filters.aging}
          blank="Any age"
          options={[{ value: 'stale', label: 'Not moved in 14 days' }]}
        />

        <div>
          <label htmlFor="from" className="sr-only">
            Raised from
          </label>
          <Input id="from" name="from" type="date" defaultValue={filters.from ?? ''} />
        </div>

        <div>
          <label htmlFor="to" className="sr-only">
            Raised to
          </label>
          <Input id="to" name="to" type="date" defaultValue={filters.to ?? ''} />
        </div>

        <div className="flex gap-2 sm:col-span-3 lg:col-span-2">
          <button
            type="submit"
            className="h-9 rounded-md border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Apply
          </button>
          <ButtonLink href="/requirements" variant="ghost">
            Clear
          </ButtonLink>
        </div>
      </form>

      {requirements.length === 0 ? (
        <EmptyState>
          {query === ''
            ? 'No live requirements. Raise one from a staffing lead, or choose “Every status” to include those already filled, lost or cancelled.'
            : 'No requirements match these filters.'}
        </EmptyState>
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Requirement</TH>
                <TH>Client</TH>
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
              {requirements.map((requirement) => {
                // Ageing is measured against the stage's own threshold, which
                // is per-stage master data (`agingThresholdDays`) — a role sat
                // at Candidate Sourcing for three weeks is a problem, and the
                // same three weeks at Interview may not be.
                const threshold = requirement.currentStage?.agingThresholdDays
                const days = Math.floor(
                  (now.getTime() - requirement.stageChangedAt.getTime()) /
                    86_400_000,
                )
                const overdue =
                  threshold != null &&
                  days > threshold &&
                  requirement.status !== 'FILLED' &&
                  requirement.status !== 'LOST' &&
                  requirement.status !== 'CANCELLED'

                return (
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
                    <TD>
                      <a
                        href={`/clients/${requirement.client.id}`}
                        className="text-slate-700 hover:underline"
                      >
                        {requirement.client.companyName}
                      </a>
                      <div className="text-xs text-slate-500">
                        <a
                          href={`/leads/${requirement.lead.id}`}
                          className="hover:underline"
                        >
                          {requirement.lead.leadCode}
                        </a>
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
                      {requirement.budgetMax
                        ? formatMoney(requirement.budgetMax, symbol)
                        : formatMoney(requirement.budgetMin, symbol)}
                    </TD>
                    <TD className="text-slate-600">
                      {formatDate(requirement.targetDate)}
                    </TD>
                    <TD
                      className={
                        overdue ? 'font-medium text-red-600' : 'text-slate-600'
                      }
                      title={
                        overdue
                          ? `Past this stage’s ${threshold}-day threshold`
                          : undefined
                      }
                    >
                      {formatAge(requirement.stageChangedAt, now)}
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
                )
              })}
            </TBody>
          </Table>

          <p className="text-xs text-slate-500">
            Showing {requirements.length} of {total} requirements
            {total > PAGE_SIZE ? ' — narrow the filters to see the rest' : ''}.
          </p>
        </>
      )}
    </div>
  )
}

function FilterSelect({
  id,
  label,
  value,
  blank,
  options,
}: {
  id: string
  label: string
  value: string | undefined
  blank: string
  options: Array<{ value: string; label: string }>
}) {
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Select id={id} name={id} defaultValue={value ?? ''}>
        <option value="">{blank}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  )
}
