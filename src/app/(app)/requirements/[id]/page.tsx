import { prisma } from '@/lib/db'
import { can } from '@/lib/authz'
import { requireUser } from '@/lib/auth/session'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { formatAge, formatDate, formatMoney } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Card, EmptyState } from '@/components/ui/page'
import { loadRequirement } from './requirement'
import { SubmitCandidate, type CandidateOption } from './submit-candidate'

type Params = Promise<{ id: string }>

/** Same cap and same reasoning as the lead form's client picker. */
const CANDIDATE_PICKER_LIMIT = 500

/**
 * The submission board — every candidate put forward for this requirement,
 * grouped by the stage they have reached (README §16).
 *
 * Columns rather than a table, because the question this screen answers is
 * "where is everything stuck", and that is a shape question. The columns come
 * from `CandidateStage` in stage order, so renaming or reordering the list in
 * Master Data reshapes the board with no code change — the same rule the funnel
 * and the lead form follow.
 *
 * Empty columns are kept. A board that hid Interview Scheduled because nobody
 * is there right now would quietly stop looking like a pipeline, and "nothing
 * has reached interview" is the most useful thing this screen can say.
 */
export default async function SubmissionBoardPage({
  params,
}: {
  params: Params
}) {
  const viewer = await requireUser()
  const { id } = await params
  const requirement = await loadRequirement(viewer, id)

  const [stages, submissions, candidates, symbol, canSubmit] = await Promise.all([
    prisma.candidateStage.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        sortOrder: true,
        isPlaced: true,
        isRejected: true,
      },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.candidateSubmission.findMany({
      where: { requirementId: requirement.id },
      select: {
        id: true,
        currentStageId: true,
        stageChangedAt: true,
        submittedAt: true,
        offeredSalary: true,
        rejectedReason: true,
        joiningDate: true,
        candidate: {
          select: {
            id: true,
            candidateCode: true,
            fullName: true,
            totalExperienceYears: true,
            currentLocation: true,
          },
        },
        submittedBy: { select: { name: true } },
        _count: { select: { interviews: true } },
      },
      orderBy: { stageChangedAt: 'desc' },
    }),
    prisma.candidate.findMany({
      where: { isDeleted: false, isActive: true },
      select: {
        id: true,
        candidateCode: true,
        fullName: true,
        primarySkills: true,
        totalExperienceYears: true,
      },
      orderBy: { createdAt: 'desc' },
      take: CANDIDATE_PICKER_LIMIT,
    }),
    currencySymbol(),
    can(viewer, PERMISSIONS.STAFFING_CANDIDATE_MANAGE),
  ])

  // A submission whose stage has since been retired would otherwise vanish from
  // the board while still counting in every metric. Retired stages get their own
  // column at the end rather than being dropped.
  const known = new Set(stages.map((stage) => stage.id))
  const orphaned = submissions.filter(
    (submission) => !known.has(submission.currentStageId),
  )

  const options: CandidateOption[] = candidates.map((candidate) => ({
    id: candidate.id,
    label: [
      candidate.fullName,
      candidate.totalExperienceYears
        ? `${candidate.totalExperienceYears.toString()} yrs`
        : null,
      candidate.primarySkills,
    ]
      .filter(Boolean)
      .join(' · '),
  }))

  const base = `/requirements/${requirement.id}`

  return (
    <div className="space-y-4">
      <Card
        title="Submission board"
        description="Every profile put forward for this role, in the stage it has reached. Open one to move it, record an interview or mark the join."
        actions={
          canSubmit ? (
            <SubmitCandidate
              requirementId={requirement.id}
              candidates={options}
              currencySymbol={symbol}
              truncated={candidates.length === CANDIDATE_PICKER_LIMIT}
            />
          ) : null
        }
      >
        {submissions.length === 0 ? (
          <EmptyState>
            No profiles submitted yet. Search the candidate master and put
            someone forward — the requirement stays at Candidate Sourcing until
            you do.
          </EmptyState>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {stages.map((stage) => {
              const column = submissions.filter(
                (submission) => submission.currentStageId === stage.id,
              )

              return (
                <div key={stage.id} className="w-64 shrink-0">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {stage.name}
                    </h3>
                    <Badge
                      tone={
                        stage.isPlaced
                          ? 'success'
                          : stage.isRejected
                            ? 'danger'
                            : 'neutral'
                      }
                    >
                      {column.length}
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    {column.length === 0 ? (
                      <p className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
                        Nobody here
                      </p>
                    ) : (
                      column.map((submission) => (
                        <a
                          key={submission.id}
                          href={`${base}/submissions/${submission.id}`}
                          className="block rounded-md border border-slate-200 bg-white p-2.5 transition hover:border-slate-300 hover:bg-slate-50"
                        >
                          <p className="truncate text-sm font-medium text-slate-900">
                            {submission.candidate.fullName}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {submission.candidate.candidateCode}
                            {submission.candidate.totalExperienceYears
                              ? ` · ${submission.candidate.totalExperienceYears.toString()} yrs`
                              : ''}
                            {submission.candidate.currentLocation
                              ? ` · ${submission.candidate.currentLocation}`
                              : ''}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            {formatAge(submission.stageChangedAt)} in stage
                            {submission._count.interviews > 0
                              ? ` · ${submission._count.interviews} round${submission._count.interviews === 1 ? '' : 's'}`
                              : ''}
                          </p>
                          {stage.isPlaced && submission.joiningDate ? (
                            <p className="mt-1 text-xs font-medium text-emerald-700">
                              Joined {formatDate(submission.joiningDate)}
                            </p>
                          ) : null}
                          {stage.isRejected && submission.rejectedReason ? (
                            <p className="mt-1 truncate text-xs text-red-600">
                              {submission.rejectedReason}
                            </p>
                          ) : null}
                          {submission.offeredSalary ? (
                            <p className="mt-1 text-xs text-slate-500">
                              {formatMoney(submission.offeredSalary, symbol)}
                            </p>
                          ) : null}
                        </a>
                      ))
                    )}
                  </div>
                </div>
              )
            })}

            {orphaned.length > 0 ? (
              <div className="w-64 shrink-0">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-600">
                  Retired stage
                </h3>
                <div className="space-y-2">
                  {orphaned.map((submission) => (
                    <a
                      key={submission.id}
                      href={`${base}/submissions/${submission.id}`}
                      className="block rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm hover:bg-amber-100"
                    >
                      {submission.candidate.fullName}
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      <Card title="The role">
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Skills" value={requirement.skills} />
          <Fact
            label="Experience"
            value={
              requirement.minExperience || requirement.maxExperience
                ? `${requirement.minExperience?.toString() ?? '0'} – ${requirement.maxExperience?.toString() ?? '?'} years`
                : null
            }
          />
          <Fact label="Location" value={requirement.location} />
          <Fact label="Work mode" value={requirement.workMode} />
          <Fact
            label="Raised"
            value={formatDate(requirement.createdAt)}
          />
          <Fact
            label="Lead"
            value={`${requirement.lead.leadCode} · ${requirement.lead.title}`}
          />
          {requirement.description ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Description
              </dt>
              <dd className="mt-0.5 whitespace-pre-wrap text-slate-700">
                {requirement.description}
              </dd>
            </div>
          ) : null}
        </dl>
      </Card>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-slate-700">{value ?? '—'}</dd>
    </div>
  )
}
