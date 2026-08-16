import { prisma } from '@/lib/db'
import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { formatDate, formatMoney } from '@/lib/format'
import { CANDIDATE_SOURCE_CHANNELS } from '@/lib/staffing/display'
import { AccessDenied } from '@/components/access-denied'
import { ActiveBadge, Badge } from '@/components/ui/badge'
import { ButtonLink } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/field'
import { EmptyState, PageHeader } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  candidateFilterQuery,
  candidateWhere,
  pickCandidateFilters,
} from './filters'

export const metadata = { title: 'Candidates · Sales CRM' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const PAGE_SIZE = 100

/**
 * The candidate master, searchable by skill, experience and location
 * (docs/03 §1).
 *
 * This is the screen decision D9 exists for. A recruiter with a new Java
 * requirement should find the person they screened for a different client last
 * month here, and submit that same row again — which keeps Candidates Sourced
 * counting people rather than submissions.
 */
export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.STAFFING_CANDIDATE_MANAGE)
  if (!viewer) return <AccessDenied what="the candidate master" />

  const filters = pickCandidateFilters(await searchParams)
  const query = candidateFilterQuery(filters)
  const where = candidateWhere(filters)

  const [candidates, total, symbol] = await Promise.all([
    prisma.candidate.findMany({
      where,
      select: {
        id: true,
        candidateCode: true,
        fullName: true,
        email: true,
        phone: true,
        currentLocation: true,
        totalExperienceYears: true,
        primarySkills: true,
        currentEmployer: true,
        expectedCtc: true,
        noticePeriodDays: true,
        sourceChannel: true,
        isActive: true,
        createdAt: true,
        _count: { select: { submissions: true, placements: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
    }),
    prisma.candidate.count({ where }),
    currencySymbol(),
  ])

  return (
    <div className="space-y-5">
      <PageHeader
        title="Candidates"
        description="One row per person, reused across every requirement they are put forward for. Submitting the same profile twice is what keeps Candidates Sourced honest."
        actions={<ButtonLink href="/candidates/new">Add candidate</ButtonLink>}
      />

      <form className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6" method="get">
        <div className="sm:col-span-3 lg:col-span-2">
          <label htmlFor="q" className="sr-only">
            Search candidates
          </label>
          <Input
            id="q"
            name="q"
            defaultValue={filters.q ?? ''}
            placeholder="Name, code, email, phone or employer"
          />
        </div>

        <div className="sm:col-span-3 lg:col-span-2">
          <label htmlFor="skill" className="sr-only">
            Skills
          </label>
          <Input
            id="skill"
            name="skill"
            defaultValue={filters.skill ?? ''}
            placeholder="Skills — comma separated, all must match"
          />
        </div>

        <div>
          <label htmlFor="location" className="sr-only">
            Location
          </label>
          <Input
            id="location"
            name="location"
            defaultValue={filters.location ?? ''}
            placeholder="Location"
          />
        </div>

        <div>
          <label htmlFor="notice" className="sr-only">
            Maximum notice period
          </label>
          <Input
            id="notice"
            name="notice"
            inputMode="numeric"
            defaultValue={filters.notice ?? ''}
            placeholder="Notice ≤ days"
          />
        </div>

        <div>
          <label htmlFor="minExp" className="sr-only">
            Minimum experience
          </label>
          <Input
            id="minExp"
            name="minExp"
            inputMode="decimal"
            defaultValue={filters.minExp ?? ''}
            placeholder="Min years"
          />
        </div>

        <div>
          <label htmlFor="maxExp" className="sr-only">
            Maximum experience
          </label>
          <Input
            id="maxExp"
            name="maxExp"
            inputMode="decimal"
            defaultValue={filters.maxExp ?? ''}
            placeholder="Max years"
          />
        </div>

        <div>
          <label htmlFor="source" className="sr-only">
            Sourced from
          </label>
          <Select id="source" name="source" defaultValue={filters.source ?? ''}>
            <option value="">Any source</option>
            {CANDIDATE_SOURCE_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {channel}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label htmlFor="status" className="sr-only">
            Status
          </label>
          <Select id="status" name="status" defaultValue={filters.status ?? ''}>
            <option value="">Active only</option>
            <option value="all">Including retired</option>
            <option value="inactive">Retired only</option>
          </Select>
        </div>

        <div className="flex gap-2 sm:col-span-3 lg:col-span-2">
          <button
            type="submit"
            className="h-9 rounded-md border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Apply
          </button>
          <ButtonLink href="/candidates" variant="ghost">
            Clear
          </ButtonLink>
        </div>
      </form>

      {candidates.length === 0 ? (
        <EmptyState>
          {query === ''
            ? 'No candidates in the master yet. Add the first one, then submit them to a requirement.'
            : 'Nobody matches this search. Every skill you type has to appear on the profile — try one term.'}
        </EmptyState>
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Candidate</TH>
                <TH>Skills</TH>
                <TH className="text-right">Experience</TH>
                <TH>Location</TH>
                <TH className="text-right">Expected</TH>
                <TH className="text-right">Notice</TH>
                <TH className="text-right">Submissions</TH>
                <TH>Added</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {candidates.map((candidate) => (
                <TR key={candidate.id}>
                  <TD>
                    <a
                      href={`/candidates/${candidate.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {candidate.fullName}
                    </a>
                    <div className="text-xs text-slate-500">
                      {candidate.candidateCode}
                      {candidate.currentEmployer
                        ? ` · ${candidate.currentEmployer}`
                        : ''}
                    </div>
                  </TD>
                  <TD className="max-w-64 truncate text-slate-600">
                    {candidate.primarySkills ?? '—'}
                  </TD>
                  <TD className="text-right tabular-nums text-slate-600">
                    {candidate.totalExperienceYears
                      ? `${candidate.totalExperienceYears.toString()} yrs`
                      : '—'}
                  </TD>
                  <TD className="text-slate-600">
                    {candidate.currentLocation ?? '—'}
                  </TD>
                  <TD className="text-right text-slate-600">
                    {formatMoney(candidate.expectedCtc, symbol)}
                  </TD>
                  <TD className="text-right tabular-nums text-slate-600">
                    {candidate.noticePeriodDays != null
                      ? `${candidate.noticePeriodDays} d`
                      : '—'}
                  </TD>
                  <TD className="text-right tabular-nums text-slate-600">
                    {candidate._count.submissions}
                    {candidate._count.placements > 0 ? (
                      <div className="text-xs text-emerald-700">
                        {candidate._count.placements} placed
                      </div>
                    ) : null}
                  </TD>
                  <TD className="text-slate-600">
                    {formatDate(candidate.createdAt)}
                  </TD>
                  <TD>
                    <div className="flex flex-col items-start gap-1">
                      <ActiveBadge active={candidate.isActive} />
                      {candidate.sourceChannel ? (
                        <Badge>{candidate.sourceChannel}</Badge>
                      ) : null}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>

          <p className="text-xs text-slate-500">
            Showing {candidates.length} of {total} candidates
            {total > PAGE_SIZE ? ' — narrow the filters to see the rest' : ''}.
          </p>
        </>
      )}
    </div>
  )
}
