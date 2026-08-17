import { prisma } from '@/lib/db'
import { can, pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { requirementVisibilityFilter } from '@/lib/visibility'
import { formatDate, formatMoney } from '@/lib/format'
import { AccessDenied } from '@/components/access-denied'
import { ButtonLink } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { EmptyState, PageHeader } from '@/components/ui/page'
import { Stat, StatRow } from '@/components/ui/stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { ReversePlacementControl } from './reverse-control'

export const metadata = { title: 'Placements · Sales CRM' }

type SearchParams = Promise<{ from?: string; to?: string }>

const PAGE_SIZE = 200

/**
 * The placement register (docs/03 §1).
 *
 * One row per person who actually joined — the revenue unit for Staffing
 * (decision D8). `SUM(placementValue)` here is exactly what docs/02 §5 defines
 * as Won Revenue for a staffing lead, which is why the total sits at the top of
 * the screen rather than being something a reader has to add up.
 *
 * The value totals are gated on `report.revenue`, separately from seeing the
 * register itself: the permission matrix keeps "who joined and when" and "what
 * we booked for it" apart, and a recruiter needs the first without the second.
 */
export default async function PlacementsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.STAFFING_REQUIREMENT_MANAGE)
  if (!viewer) return <AccessDenied what="placements" />

  const { from, to } = await searchParams

  // Joining date is a real instant on a `DateTime` column, and the two inputs
  // are calendar days, so the upper bound is the start of the following day.
  // Reading `lte: <that day at 00:00>` would drop every placement that joined
  // on the closing date.
  const fromDate = parseDay(from)
  const toDate = parseDay(to)

  const where = {
    requirement: {
      isDeleted: false,
      ...(await requirementVisibilityFilter(viewer)),
    },
    ...(fromDate || toDate
      ? {
          joiningDate: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lt: addDay(toDate) } : {}),
          },
        }
      : {}),
  }

  const [placements, totals, symbol, canSeeRevenue, canReverse] = await Promise.all([
    prisma.placement.findMany({
      where,
      select: {
        id: true,
        joiningDate: true,
        placementValue: true,
        salary: true,
        billRate: true,
        marginPerMonth: true,
        guaranteePeriodDays: true,
        reversedAt: true,
        reversalReason: true,
        reversedBy: { select: { name: true } },
        candidate: { select: { id: true, fullName: true, candidateCode: true } },
        requirement: {
          select: {
            id: true,
            requirementCode: true,
            position: true,
            assignedTo: { select: { name: true } },
            client: { select: { id: true, companyName: true } },
          },
        },
        lead: { select: { id: true, leadCode: true } },
        submission: { select: { id: true } },
      },
      orderBy: { joiningDate: 'desc' },
      take: PAGE_SIZE,
    }),
    // Reversed placements are listed but never totalled. Somebody who withdrew
    // after joining is part of the record of what happened on that requirement,
    // and hiding the row would make the drop in Won Revenue unattributable —
    // which is the whole reason a reversal is a record rather than a delete.
    prisma.placement.aggregate({
      where: { ...where, reversedAt: null },
      _count: { _all: true },
      _sum: { placementValue: true, marginPerMonth: true },
    }),
    currencySymbol(),
    can(viewer, PERMISSIONS.REPORT_REVENUE),
    can(viewer, PERMISSIONS.COMMERCIAL_MANAGE),
  ])

  const reversedCount = placements.filter(
    (placement) => placement.reversedAt !== null,
  ).length

  return (
    <div className="space-y-5">
      <PageHeader
        title="Placements"
        description="Everyone who has actually joined. One row per filled opening — a three-opening requirement filled completely produces three placements."
      />

      <form
        method="get"
        className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3"
      >
        <div>
          <label
            htmlFor="from"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Joined from
          </label>
          <Input id="from" name="from" type="date" defaultValue={from ?? ''} />
        </div>
        <div>
          <label
            htmlFor="to"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Joined to
          </label>
          <Input id="to" name="to" type="date" defaultValue={to ?? ''} />
        </div>
        <button
          type="submit"
          className="h-9 rounded-md border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Apply
        </button>
        <ButtonLink href="/placements" variant="ghost">
          Clear
        </ButtonLink>
      </form>

      <StatRow>
        <Stat
          label="Placements"
          value={String(totals._count._all)}
          hint={
            reversedCount > 0
              ? `${reversedCount} reversed, excluded from these figures`
              : undefined
          }
        />
        {canSeeRevenue ? (
          <>
            <Stat
              label="Won revenue"
              value={formatMoney(totals._sum.placementValue, symbol)}
              hint="What Staffing contributes to Won Revenue (docs/02 §5)"
            />
            <Stat
              label="Margin per month"
              value={formatMoney(totals._sum.marginPerMonth, symbol)}
              hint="Across placements where a margin was recorded"
            />
          </>
        ) : null}
      </StatRow>

      {placements.length === 0 ? (
        <EmptyState>
          No placements in this period. A placement is created when a candidate
          is marked as joined on a requirement&rsquo;s submission board.
        </EmptyState>
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Candidate</TH>
                <TH>Requirement</TH>
                <TH>Client</TH>
                <TH>Joined</TH>
                <TH>Recruiter</TH>
                {canSeeRevenue ? (
                  <>
                    <TH className="text-right">Placement value</TH>
                    <TH className="text-right">Salary</TH>
                    <TH className="text-right">Bill rate</TH>
                  </>
                ) : null}
                <TH className="text-right">Guarantee</TH>
                {canReverse ? (
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                ) : null}
              </TR>
            </THead>
            <TBody>
              {placements.map((placement) => (
                <TR
                  key={placement.id}
                  className={placement.reversedAt ? 'bg-slate-50' : undefined}
                >
                  <TD>
                    <a
                      href={`/requirements/${placement.requirement.id}/submissions/${placement.submission.id}`}
                      className={
                        placement.reversedAt
                          ? 'font-medium text-slate-500 line-through hover:underline'
                          : 'font-medium text-slate-900 hover:underline'
                      }
                    >
                      {placement.candidate.fullName}
                    </a>
                    <div className="text-xs text-slate-500">
                      {placement.candidate.candidateCode}
                    </div>
                    {placement.reversedAt ? (
                      <div className="mt-1 max-w-56 text-xs text-red-700">
                        Reversed {formatDate(placement.reversedAt)}
                        {placement.reversedBy
                          ? ` by ${placement.reversedBy.name}`
                          : ''}
                        {placement.reversalReason
                          ? ` — ${placement.reversalReason}`
                          : ''}
                      </div>
                    ) : null}
                  </TD>
                  <TD>
                    <a
                      href={`/requirements/${placement.requirement.id}`}
                      className="text-slate-700 hover:underline"
                    >
                      {placement.requirement.requirementCode}
                    </a>
                    <div className="max-w-56 truncate text-xs text-slate-500">
                      {placement.requirement.position}
                    </div>
                  </TD>
                  <TD>
                    <a
                      href={`/clients/${placement.requirement.client.id}`}
                      className="text-slate-700 hover:underline"
                    >
                      {placement.requirement.client.companyName}
                    </a>
                    <div className="text-xs text-slate-500">
                      <a
                        href={`/leads/${placement.lead.id}`}
                        className="hover:underline"
                      >
                        {placement.lead.leadCode}
                      </a>
                    </div>
                  </TD>
                  <TD className="text-slate-600">
                    {formatDate(placement.joiningDate)}
                  </TD>
                  <TD className="text-slate-600">
                    {placement.requirement.assignedTo?.name ?? 'Unassigned'}
                  </TD>
                  {canSeeRevenue ? (
                    <>
                      <TD className="text-right font-medium text-slate-900">
                        {formatMoney(placement.placementValue, symbol)}
                      </TD>
                      <TD className="text-right text-slate-600">
                        {formatMoney(placement.salary, symbol)}
                      </TD>
                      <TD className="text-right text-slate-600">
                        {formatMoney(placement.billRate, symbol)}
                      </TD>
                    </>
                  ) : null}
                  <TD className="text-right tabular-nums text-slate-600">
                    {placement.guaranteePeriodDays
                      ? `${placement.guaranteePeriodDays} d`
                      : '—'}
                  </TD>
                  {canReverse ? (
                    <TD>
                      {placement.reversedAt ? null : (
                        <ReversePlacementControl
                          placementId={placement.id}
                          candidateName={placement.candidate.fullName}
                        />
                      )}
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>

          <p className="text-xs text-slate-500">
            Showing {placements.length} row
            {placements.length === 1 ? '' : 's'}
            {placements.length === PAGE_SIZE
              ? ' — narrow the date range to see the rest'
              : ''}
            . {totals._count._all} placement
            {totals._count._all === 1 ? '' : 's'} in this period count towards
            the figures above
            {reversedCount > 0
              ? `; ${reversedCount} reversed row${reversedCount === 1 ? '' : 's'} shown here do not`
              : ''}
            . Raise an invoice against a placement from its lead&rsquo;s
            Commercials tab.
          </p>
        </>
      )}
    </div>
  )
}

/**
 * A `yyyy-MM-dd` input as local midnight.
 *
 * Built from its parts rather than handed to `new Date()`, which reads a bare
 * date as UTC — west of UTC that lands on the previous day, so a "from 16 Aug"
 * filter would quietly include the 15th.
 */
function parseDay(value: string | undefined): Date | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null

  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(year, month - 1, day)

  return date.getMonth() === month - 1 && date.getDate() === day ? date : null
}

function addDay(date: Date): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + 1)
  return next
}
