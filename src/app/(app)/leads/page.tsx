import { prisma } from '@/lib/db'
import { can, pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { formatAge, formatDate, formatMoney } from '@/lib/format'
import {
  COMMON_STAGE_LABELS,
  COMMON_STAGE_ORDER,
  LEAD_STATUS_LABELS,
  LEAD_STATUS_TONES,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  PRIORITY_TONES,
} from '@/lib/leads/display'
import { AccessDenied } from '@/components/access-denied'
import { ButtonLink } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input, Select } from '@/components/ui/field'
import { PageHeader, EmptyState } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { leadFilterQuery, leadWhere, pickLeadFilters } from './filters'
import { SavedViews, type SavedViewItem } from './views/saved-views'

export const metadata = { title: 'Leads · Sales CRM' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** Same reasoning as the client list: filters are the way to narrow, not pages. */
const PAGE_SIZE = 100

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.LEAD_VIEW)
  if (!viewer) return <AccessDenied what="leads" />

  const filters = pickLeadFilters(await searchParams)
  const query = leadFilterQuery(filters)
  const where = await leadWhere(viewer, filters)

  const [
    leads,
    total,
    verticals,
    sources,
    teams,
    people,
    views,
    symbol,
    canExport,
    canCreate,
  ] = await Promise.all([
    prisma.lead.findMany({
      where,
      select: {
        id: true,
        leadCode: true,
        title: true,
        status: true,
        commonStage: true,
        priority: true,
        dealValue: true,
        expectedBudget: true,
        stageChangedAt: true,
        nextFollowUpAt: true,
        createdAt: true,
        client: { select: { id: true, clientName: true } },
        vertical: { select: { name: true } },
        currentStage: { select: { name: true } },
        generatedBy: { select: { name: true } },
        assignedTo: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
    }),
    prisma.lead.count({ where }),
    prisma.salesVertical.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.leadSource.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.team.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    // Own views plus anything shared. A shared view is a filter, not data —
    // whoever opens it still sees only the leads their own scope allows.
    prisma.savedView.findMany({
      where: {
        entity: 'LEAD',
        OR: [{ userId: viewer.id }, { isShared: true }],
      },
      select: {
        id: true,
        name: true,
        filters: true,
        isShared: true,
        userId: true,
        user: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    }),
    currencySymbol(),
    can(viewer, PERMISSIONS.DATA_EXPORT),
    can(viewer, PERMISSIONS.LEAD_CREATE),
  ])

  const viewItems: SavedViewItem[] = views.map((view) => ({
    id: view.id,
    name: view.name,
    // `filters` is a Json column, so its contents are re-validated on the way
    // out through the same picker the URL goes through. A view saved before a
    // filter was renamed then quietly drops the key rather than producing a URL
    // parameter nothing reads.
    query: leadFilterQuery(
      pickLeadFilters(
        (view.filters ?? {}) as Record<string, string | string[] | undefined>,
      ),
    ),
    isShared: view.isShared,
    isOwn: view.userId === viewer.id,
    ownerName: view.user.name,
  }))

  const now = new Date()

  return (
    <div className="space-y-5">
      <PageHeader
        title="Leads"
        description="Every opportunity across all eight verticals, in one common pipeline."
        actions={
          <>
            {canExport ? (
              <ButtonLink
                href={`/leads/export${query ? `?${query}` : ''}`}
                variant="secondary"
                prefetch={false}
              >
                Export CSV
              </ButtonLink>
            ) : null}
            {canCreate ? <ButtonLink href="/leads/new">New lead</ButtonLink> : null}
          </>
        }
      />

      <SavedViews
        views={viewItems}
        currentQuery={query}
        canSave
        canShare={canExport}
      />

      <form className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6" method="get">
        <div className="sm:col-span-3 lg:col-span-2">
          <label htmlFor="q" className="sr-only">
            Search leads
          </label>
          <Input
            id="q"
            name="q"
            defaultValue={filters.q ?? ''}
            placeholder="Lead code, requirement or company"
          />
        </div>

        <FilterSelect
          id="vertical"
          label="Vertical"
          value={filters.vertical}
          blank="All verticals"
          options={verticals.map((row) => ({ value: row.id, label: row.name }))}
        />

        <FilterSelect
          id="stage"
          label="Stage"
          value={filters.stage}
          blank="All stages"
          options={COMMON_STAGE_ORDER.map((stage) => ({
            value: stage,
            label: COMMON_STAGE_LABELS[stage],
          }))}
        />

        <FilterSelect
          id="status"
          label="Status"
          value={filters.status}
          blank="All statuses"
          options={(['OPEN', 'WON', 'LOST'] as const).map((status) => ({
            value: status,
            label: LEAD_STATUS_LABELS[status],
          }))}
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
          id="source"
          label="Source"
          value={filters.source}
          blank="All sources"
          options={sources.map((row) => ({ value: row.id, label: row.name }))}
        />

        <FilterSelect
          id="bde"
          label="Generated by"
          value={filters.bde}
          blank="Any BDE"
          options={people.map((row) => ({ value: row.id, label: row.name }))}
        />

        <FilterSelect
          id="bdm"
          label="Assigned to"
          value={filters.bdm}
          blank="Anyone"
          options={people.map((row) => ({ value: row.id, label: row.name }))}
        />

        <FilterSelect
          id="team"
          label="Team"
          value={filters.team}
          blank="All teams"
          options={teams.map((row) => ({ value: row.id, label: row.name }))}
        />

        <FilterSelect
          id="follow"
          label="Follow-up"
          value={filters.follow}
          blank="Any follow-up"
          options={[
            { value: 'overdue', label: 'Overdue' },
            { value: 'today', label: 'Due today' },
            { value: 'none', label: 'None set' },
          ]}
        />

        <div>
          <label htmlFor="from" className="sr-only">
            Created from
          </label>
          <Input id="from" name="from" type="date" defaultValue={filters.from ?? ''} />
        </div>

        <div>
          <label htmlFor="to" className="sr-only">
            Created to
          </label>
          <Input id="to" name="to" type="date" defaultValue={filters.to ?? ''} />
        </div>

        {/*
          * A checkbox rather than a hidden parameter, because the dashboard
          * links here with it set. An active filter with no control to see or
          * clear it makes a short list look like missing data.
          */}
        <div className="flex items-center gap-2 sm:col-span-3 lg:col-span-2">
          <input
            id="mine"
            name="mine"
            type="checkbox"
            value="1"
            defaultChecked={filters.mine === '1'}
            className="size-4 rounded border-slate-300"
          />
          <label htmlFor="mine" className="text-sm text-slate-700">
            Only my leads
          </label>
        </div>

        <div className="flex gap-2 sm:col-span-3 lg:col-span-2">
          <button
            type="submit"
            className="h-9 rounded-md border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Apply
          </button>
          <ButtonLink href="/leads" variant="ghost">
            Clear
          </ButtonLink>
        </div>
      </form>

      {leads.length === 0 ? (
        <EmptyState>
          {query === ''
            ? 'No leads yet. Create one, or log prospecting counters until a prospect responds.'
            : 'No leads match these filters.'}
        </EmptyState>
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Lead</TH>
                <TH>Client</TH>
                <TH>Vertical</TH>
                <TH>Stage</TH>
                <TH>Generated / assigned</TH>
                <TH className="text-right">Value</TH>
                <TH>In stage</TH>
                <TH>Follow-up</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {leads.map((lead) => {
                const overdue =
                  lead.nextFollowUpAt &&
                  lead.nextFollowUpAt < now &&
                  lead.status === 'OPEN'

                return (
                  <TR key={lead.id}>
                    <TD>
                      <a
                        href={`/leads/${lead.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {lead.leadCode}
                      </a>
                      <div className="max-w-64 truncate text-xs text-slate-500">
                        {lead.title}
                      </div>
                    </TD>
                    <TD>
                      <a
                        href={`/clients/${lead.client.id}`}
                        className="text-slate-700 hover:underline"
                      >
                        {lead.client.clientName}
                      </a>
                    </TD>
                    <TD className="text-slate-600">{lead.vertical.name}</TD>
                    <TD className="text-slate-600">
                      {lead.currentStage?.name ?? '—'}
                      <div className="text-xs text-slate-500">
                        {COMMON_STAGE_LABELS[lead.commonStage]}
                      </div>
                    </TD>
                    <TD className="text-slate-600">
                      {lead.generatedBy.name}
                      <div className="text-xs text-slate-500">
                        {lead.assignedTo?.name ?? 'Unassigned'}
                      </div>
                    </TD>
                    <TD className="text-right text-slate-600">
                      {formatMoney(lead.dealValue ?? lead.expectedBudget, symbol)}
                    </TD>
                    <TD className="text-slate-600">
                      {formatAge(lead.stageChangedAt, now)}
                    </TD>
                    <TD
                      className={
                        overdue ? 'font-medium text-red-600' : 'text-slate-600'
                      }
                    >
                      {formatDate(lead.nextFollowUpAt)}
                    </TD>
                    <TD>
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={LEAD_STATUS_TONES[lead.status]}>
                          {LEAD_STATUS_LABELS[lead.status]}
                        </Badge>
                        {lead.priority === 'MEDIUM' || lead.priority === 'LOW' ? null : (
                          <Badge tone={PRIORITY_TONES[lead.priority]}>
                            {PRIORITY_LABELS[lead.priority]}
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
            Showing {leads.length} of {total} leads
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
