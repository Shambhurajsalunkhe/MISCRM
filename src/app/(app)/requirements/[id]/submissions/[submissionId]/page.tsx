import { notFound } from 'next/navigation'

import { prisma } from '@/lib/db'
import { can } from '@/lib/authz'
import { requireUser } from '@/lib/auth/session'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { requirementVisibilityFilter } from '@/lib/visibility'
import { formatAge, formatDate, formatDateTime, formatMoney } from '@/lib/format'
import {
  INTERVIEW_RESULT_LABELS,
  INTERVIEW_RESULT_TONES,
} from '@/lib/staffing/display'
import {
  AccessDenied,
  STAFFING_ACCESS_REASON,
} from '@/components/access-denied'
import { Badge } from '@/components/ui/badge'
import { ButtonLink } from '@/components/ui/button'
import { Card, EmptyState, PageHeader } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { RowAction } from '@/components/row-action'
import { DocumentTable } from '@/components/documents/document-table'
import { UploadForm } from '@/components/documents/upload-form'
import { deleteInterviewAction } from '../../../actions'
import {
  InterviewResultForm,
  ScheduleInterview,
} from './interview-controls'
import { SubmissionStageControl } from './submission-stage-control'

type Params = Promise<{ id: string; submissionId: string }>

export const metadata = { title: 'Submission · Sales CRM' }

/**
 * One candidate against one requirement — the record that carries everything
 * per-requirement about a person (docs/01-data-model.md §2).
 *
 * Nested under the requirement's route, so it renders inside that shell and
 * keeps the header a recruiter needs while working a profile — how many
 * openings are left is the thing that decides whether marking a join is even
 * possible. No tab is highlighted, since this is a card off the board rather
 * than a tab of its own, which is why the header carries an explicit way back.
 *
 * Everything here is per-requirement. The reusable half of a person — their
 * resume, their skills, every other role they have been put forward for —
 * lives on the candidate profile, one link away (decision D9).
 */
export default async function SubmissionPage({ params }: { params: Params }) {
  const viewer = await requireUser()
  if (!(await can(viewer, PERMISSIONS.STAFFING_CANDIDATE_MANAGE))) {
    return (
      <AccessDenied
        what="candidate submissions"
        reason={STAFFING_ACCESS_REASON}
      />
    )
  }

  const { id, submissionId } = await params

  const submission = await prisma.candidateSubmission.findFirst({
    where: {
      id: submissionId,
      // Both the requirement's scope *and* that it is the requirement in the
      // URL. Without the second check, a submission id from another role would
      // render under this requirement's breadcrumb.
      requirementId: id,
      requirement: {
        isDeleted: false,
        ...(await requirementVisibilityFilter(viewer)),
      },
    },
    select: {
      id: true,
      currentStageId: true,
      stageChangedAt: true,
      submittedAt: true,
      clientFeedback: true,
      rejectedReason: true,
      offerDate: true,
      joiningDate: true,
      offeredSalary: true,
      billRate: true,
      currentStage: { select: { id: true, name: true, isPlaced: true, isRejected: true } },
      submittedBy: { select: { name: true } },
      candidate: {
        select: {
          id: true,
          candidateCode: true,
          fullName: true,
          email: true,
          phone: true,
          currentLocation: true,
          totalExperienceYears: true,
          primarySkills: true,
          noticePeriodDays: true,
          expectedCtc: true,
        },
      },
      requirement: {
        select: {
          id: true,
          requirementCode: true,
          position: true,
          openings: true,
          positionsFilled: true,
          client: { select: { clientName: true } },
        },
      },
      placement: {
        select: {
          id: true,
          joiningDate: true,
          placementValue: true,
          salary: true,
          billRate: true,
          marginPerMonth: true,
          guaranteePeriodDays: true,
        },
      },
      interviews: {
        select: {
          id: true,
          roundNumber: true,
          scheduledAt: true,
          completedAt: true,
          mode: true,
          interviewerName: true,
          feedback: true,
          result: true,
        },
        orderBy: { roundNumber: 'asc' },
      },
      documents: {
        select: {
          id: true,
          fileName: true,
          docType: true,
          description: true,
          sizeBytes: true,
          createdAt: true,
          uploadedBy: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      stageHistory: {
        select: {
          id: true,
          changedAt: true,
          note: true,
          fromStage: { select: { name: true } },
          toStage: { select: { name: true } },
          changedBy: { select: { name: true } },
        },
        orderBy: { changedAt: 'desc' },
      },
    },
  })

  if (!submission) notFound()

  const [stages, symbol, canUpload] = await Promise.all([
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
    currencySymbol(),
    can(viewer, PERMISSIONS.ACTIVITY_MANAGE),
  ])

  const { candidate, requirement } = submission
  const openingsLeft = Math.max(
    0,
    requirement.openings - requirement.positionsFilled,
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title={candidate.fullName}
        description={`${candidate.candidateCode} on ${requirement.requirementCode} — ${requirement.position} for ${requirement.client.clientName}.`}
        actions={
          <>
            <ButtonLink
              href={`/candidates/${candidate.id}`}
              variant="secondary"
              size="sm"
            >
              Candidate profile
            </ButtonLink>
            <ButtonLink
              href={`/requirements/${requirement.id}`}
              variant="ghost"
              size="sm"
            >
              Back to the board
            </ButtonLink>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge
          tone={
            submission.currentStage.isPlaced
              ? 'success'
              : submission.currentStage.isRejected
                ? 'danger'
                : 'info'
          }
        >
          {submission.currentStage.name}
        </Badge>
        <span className="text-xs text-slate-500">
          {formatAge(submission.stageChangedAt)} in stage · submitted{' '}
          {formatDate(submission.submittedAt)} by {submission.submittedBy.name}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Move this candidate"
          description="Every move is written to the candidate stage history, which is what the staffing funnel's Profiles Shared, Shortlisted and Selected are counted from."
        >
          <SubmissionStageControl
            submissionId={submission.id}
            stages={stages}
            currentStageId={submission.currentStageId}
            currencySymbol={symbol}
            offeredSalary={submission.offeredSalary?.toString() ?? null}
            billRate={submission.billRate?.toString() ?? null}
            placed={submission.placement !== null}
            openingsLeft={openingsLeft}
          />
        </Card>

        <Card title="The candidate">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Fact label="Experience" value={candidate.totalExperienceYears?.toString() ? `${candidate.totalExperienceYears.toString()} years` : null} />
            <Fact label="Location" value={candidate.currentLocation} />
            <Fact label="Email" value={candidate.email} />
            <Fact label="Phone" value={candidate.phone} />
            {/* `!= null`, not truthiness: nought days' notice means an
                immediate joiner, which is a selling point rather than a
                missing value, and `0 ? …` rendered it as an em dash. */}
            <Fact
              label="Notice period"
              value={
                candidate.noticePeriodDays != null
                  ? `${candidate.noticePeriodDays} days`
                  : null
              }
            />
            <Fact
              label="Expected CTC"
              value={
                candidate.expectedCtc
                  ? formatMoney(candidate.expectedCtc, symbol)
                  : null
              }
            />
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Skills
              </dt>
              <dd className="text-slate-700">{candidate.primarySkills ?? '—'}</dd>
            </div>
            {submission.clientFeedback ? (
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wide text-slate-500">
                  Client feedback
                </dt>
                <dd className="whitespace-pre-wrap text-slate-700">
                  {submission.clientFeedback}
                </dd>
              </div>
            ) : null}
            {submission.rejectedReason ? (
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wide text-slate-500">
                  Rejected because
                </dt>
                <dd className="text-red-700">{submission.rejectedReason}</dd>
              </div>
            ) : null}
          </dl>
        </Card>
      </div>

      {submission.placement ? (
        <Card
          title="Placement"
          description="The revenue unit for Staffing (decision D8). Won Revenue for a staffing lead sums these, not the lead's deal value."
        >
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Fact
              label="Joined"
              value={formatDate(submission.placement.joiningDate)}
            />
            <Fact
              label="Placement value"
              value={formatMoney(submission.placement.placementValue, symbol)}
            />
            <Fact
              label="Salary"
              value={
                submission.placement.salary
                  ? formatMoney(submission.placement.salary, symbol)
                  : null
              }
            />
            <Fact
              label="Bill rate"
              value={
                submission.placement.billRate
                  ? formatMoney(submission.placement.billRate, symbol)
                  : null
              }
            />
            <Fact
              label="Margin per month"
              value={
                submission.placement.marginPerMonth
                  ? formatMoney(submission.placement.marginPerMonth, symbol)
                  : null
              }
            />
            <Fact
              label="Guarantee"
              value={
                submission.placement.guaranteePeriodDays
                  ? `${submission.placement.guaranteePeriodDays} days`
                  : null
              }
            />
          </dl>
        </Card>
      ) : null}

      <Card
        title="Interview rounds"
        description="Each round and its outcome. Round numbers are issued in order as rounds are added."
        actions={<ScheduleInterview submissionId={submission.id} />}
      >
        {submission.interviews.length === 0 ? (
          <EmptyState>No rounds scheduled yet.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {submission.interviews.map((interview) => (
              <li
                key={interview.id}
                className="rounded-lg border border-slate-200 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">
                        Round {interview.roundNumber}
                      </span>
                      <Badge tone={INTERVIEW_RESULT_TONES[interview.result]}>
                        {INTERVIEW_RESULT_LABELS[interview.result]}
                      </Badge>
                      {interview.mode ? <Badge>{interview.mode}</Badge> : null}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatDateTime(interview.scheduledAt)}
                      {interview.interviewerName
                        ? ` · ${interview.interviewerName}`
                        : ''}
                      {interview.completedAt
                        ? ` · completed ${formatDate(interview.completedAt)}`
                        : ''}
                    </p>
                  </div>

                  <RowAction
                    action={deleteInterviewAction}
                    id={interview.id}
                    label="Remove"
                    confirmMessage={`Remove round ${interview.roundNumber}? The audit trail keeps a record of the deletion.`}
                  />
                </div>

                <div className="mt-3">
                  <InterviewResultForm
                    interviewId={interview.id}
                    result={interview.result}
                    feedback={interview.feedback}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Documents"
          description="Anything specific to this submission — a tailored CV, the client's feedback sheet. The candidate's own resume lives on their profile."
          actions={
            canUpload ? (
              <UploadForm
                parent={{ kind: 'submission', id: submission.id }}
                defaultDocType="RESUME"
              />
            ) : null
          }
        >
          <DocumentTable
            documents={submission.documents}
            canManage={canUpload}
          />
        </Card>

        <Card title="Stage history">
          {submission.stageHistory.length === 0 ? (
            <EmptyState>No transitions recorded.</EmptyState>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>From</TH>
                  <TH>To</TH>
                  <TH>By</TH>
                  <TH>Note</TH>
                </TR>
              </THead>
              <TBody>
                {submission.stageHistory.map((row) => (
                  <TR key={row.id}>
                    <TD className="text-slate-600">
                      {formatDateTime(row.changedAt)}
                    </TD>
                    <TD className="text-slate-600">
                      {row.fromStage?.name ?? '—'}
                    </TD>
                    <TD className="font-medium text-slate-900">
                      {row.toStage.name}
                    </TD>
                    <TD className="text-slate-600">{row.changedBy.name}</TD>
                    <TD className="text-slate-600">{row.note ?? '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
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
