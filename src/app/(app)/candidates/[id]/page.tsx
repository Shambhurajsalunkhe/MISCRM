import { notFound } from 'next/navigation'

import { prisma } from '@/lib/db'
import { can, pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { requirementVisibilityFilter } from '@/lib/visibility'
import { formatAge, formatDate, formatMoney } from '@/lib/format'
import {
  AccessDenied,
  STAFFING_ACCESS_REASON,
} from '@/components/access-denied'
import { ActiveBadge, Badge } from '@/components/ui/badge'
import { ButtonLink } from '@/components/ui/button'
import { ExternalLink } from '@/components/ui/external-link'
import { Card, EmptyState, PageHeader } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { ActiveToggle } from '@/components/active-toggle'
import { ActivityForm } from '@/components/activity/activity-form'
import { Timeline } from '@/components/activity/timeline'
import { DocumentTable } from '@/components/documents/document-table'
import { UploadForm } from '@/components/documents/upload-form'
import { setCandidateActiveAction } from '../actions'

type Params = Promise<{ id: string }>

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params
  const candidate = await prisma.candidate.findUnique({
    where: { id },
    select: { fullName: true },
  })
  return { title: `${candidate?.fullName ?? 'Candidate'} · Sales CRM` }
}

/**
 * A candidate's profile, their resume and every submission they have been part
 * of (docs/03 §1).
 *
 * The submission table is the reason this page matters more than a contact
 * card: it is the one place where decision D9 is visible as a benefit rather
 * than a rule — the same person, three clients, three outcomes, one row of
 * history to read before picking up the phone.
 *
 * That table is scoped through `requirementVisibilityFilter`, and the profile
 * itself is not. Seeing a candidate is fine — they are a shared master with no
 * client's information on them. Seeing *which client* is interviewing them is
 * not, so a submission outside your scope is counted in the footnote and not
 * listed.
 */
export default async function CandidateDetailPage({
  params,
}: {
  params: Params
}) {
  const viewer = await pageAccess(PERMISSIONS.STAFFING_CANDIDATE_MANAGE)
  if (!viewer)
    return (
      <AccessDenied
        what="the candidate master"
        reason={STAFFING_ACCESS_REASON}
      />
    )

  const { id } = await params

  const candidate = await prisma.candidate.findFirst({
    where: { id, isDeleted: false },
    select: {
      id: true,
      candidateCode: true,
      fullName: true,
      email: true,
      phone: true,
      currentLocation: true,
      preferredLocation: true,
      totalExperienceYears: true,
      primarySkills: true,
      currentEmployer: true,
      currentCtc: true,
      expectedCtc: true,
      noticePeriodDays: true,
      linkedInProfile: true,
      sourceChannel: true,
      notes: true,
      isActive: true,
      createdAt: true,
      createdBy: { select: { name: true } },
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
      activities: {
        // History only -- see the lead timeline for why.
        where: { isPlanned: false },
        select: {
          id: true,
          type: true,
          subject: true,
          notes: true,
          outcome: true,
          activityDate: true,
          followUpDate: true,
          user: { select: { id: true, name: true } },
        },
        orderBy: { activityDate: 'desc' },
        take: 100,
      },
      _count: { select: { submissions: true, placements: true } },
    },
  })

  if (!candidate) notFound()

  const [submissions, reachableSubmissions, symbol, canManageActivity] =
    await Promise.all([
    prisma.candidateSubmission.findMany({
      where: {
        candidateId: candidate.id,
        requirement: {
          isDeleted: false,
          ...(await requirementVisibilityFilter(viewer)),
        },
      },
      select: {
        id: true,
        stageChangedAt: true,
        submittedAt: true,
        joiningDate: true,
        rejectedReason: true,
        currentStage: {
          select: { name: true, isPlaced: true, isRejected: true },
        },
        requirement: {
          select: {
            id: true,
            requirementCode: true,
            position: true,
            client: { select: { id: true, clientName: true } },
          },
        },
        placement: { select: { placementValue: true } },
        _count: { select: { interviews: true } },
      },
      orderBy: { submittedAt: 'desc' },
    }),
    // The denominator for "how many am I not showing". Deliberately not
    // `_count.submissions`, which counts submissions on deleted requirements
    // too — those are hidden from everyone, so counting them here would report
    // a scope restriction that is not what is actually withholding them.
    prisma.candidateSubmission.count({
      where: { candidateId: candidate.id, requirement: { isDeleted: false } },
    }),
    currencySymbol(),
    can(viewer, PERMISSIONS.ACTIVITY_MANAGE),
  ])

  const hidden = reachableSubmissions - submissions.length

  return (
    <div className="space-y-5">
      <PageHeader
        title={candidate.fullName}
        description={[
          candidate.candidateCode,
          candidate.currentEmployer,
          candidate.totalExperienceYears
            ? `${candidate.totalExperienceYears.toString()} years`
            : null,
          candidate.currentLocation,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            <ButtonLink
              href={`/candidates/${candidate.id}/edit`}
              variant="secondary"
              size="sm"
            >
              Edit
            </ButtonLink>
            <ActiveToggle
              action={setCandidateActiveAction}
              id={candidate.id}
              isActive={candidate.isActive}
              confirmMessage={
                candidate.isActive
                  ? `Retire ${candidate.fullName}? They stop appearing in skill searches. Their submissions and placements are untouched.`
                  : `Bring ${candidate.fullName} back into the active master?`
              }
            />
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <ActiveBadge active={candidate.isActive} />
        {candidate.sourceChannel ? (
          <Badge>{candidate.sourceChannel}</Badge>
        ) : null}
        {candidate._count.placements > 0 ? (
          <Badge tone="success">
            {candidate._count.placements} placement
            {candidate._count.placements === 1 ? '' : 's'}
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Profile" className="lg:col-span-2">
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Email" value={candidate.email} />
            <Fact label="Phone" value={candidate.phone} />
            <Fact
              label="Notice period"
              value={
                candidate.noticePeriodDays != null
                  ? `${candidate.noticePeriodDays} days`
                  : null
              }
            />
            <Fact label="Current location" value={candidate.currentLocation} />
            <Fact
              label="Preferred location"
              value={candidate.preferredLocation}
            />
            <Fact
              label="Current CTC"
              value={
                candidate.currentCtc
                  ? formatMoney(candidate.currentCtc, symbol)
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
            <Fact
              label="Added"
              value={`${formatDate(candidate.createdAt)} by ${candidate.createdBy.name}`}
            />
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                LinkedIn
              </dt>
              <dd className="text-slate-700">
                <ExternalLink href={candidate.linkedInProfile} />
              </dd>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Skills
              </dt>
              <dd className="text-slate-700">
                {candidate.primarySkills ?? '—'}
              </dd>
            </div>
            {candidate.notes ? (
              <div className="sm:col-span-2 lg:col-span-3">
                <dt className="text-xs uppercase tracking-wide text-slate-500">
                  Notes
                </dt>
                <dd className="whitespace-pre-wrap text-slate-700">
                  {candidate.notes}
                </dd>
              </div>
            ) : null}
          </dl>
        </Card>

        <Card
          title="Resume and documents"
          actions={
            canManageActivity ? (
              <UploadForm
                parent={{ kind: 'candidate', id: candidate.id }}
                defaultDocType="RESUME"
                label="Upload resume"
              />
            ) : null
          }
        >
          <DocumentTable
            documents={candidate.documents}
            canManage={canManageActivity}
          />
        </Card>
      </div>

      <Card
        title="Submissions"
        description="Every requirement this person has been put forward for, and how each one ended."
      >
        {submissions.length === 0 ? (
          <EmptyState>
            {hidden > 0
              ? `${hidden} submission${hidden === 1 ? '' : 's'} for this candidate ${hidden === 1 ? 'is' : 'are'} outside your scope.`
              : 'Not yet submitted to any requirement.'}
          </EmptyState>
        ) : (
          <div className="space-y-3">
            <Table>
              <THead>
                <TR>
                  <TH>Requirement</TH>
                  <TH>Client</TH>
                  <TH>Stage</TH>
                  <TH className="text-right">Rounds</TH>
                  <TH>Submitted</TH>
                  <TH>In stage</TH>
                  <TH className="text-right">Outcome</TH>
                </TR>
              </THead>
              <TBody>
                {submissions.map((submission) => (
                  <TR key={submission.id}>
                    <TD>
                      <a
                        href={`/requirements/${submission.requirement.id}/submissions/${submission.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {submission.requirement.requirementCode}
                      </a>
                      <div className="max-w-64 truncate text-xs text-slate-500">
                        {submission.requirement.position}
                      </div>
                    </TD>
                    <TD>
                      <a
                        href={`/clients/${submission.requirement.client.id}`}
                        className="text-slate-700 hover:underline"
                      >
                        {submission.requirement.client.clientName}
                      </a>
                    </TD>
                    <TD>
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
                      {submission.rejectedReason ? (
                        <div className="max-w-48 truncate text-xs text-red-600">
                          {submission.rejectedReason}
                        </div>
                      ) : null}
                    </TD>
                    <TD className="text-right tabular-nums text-slate-600">
                      {submission._count.interviews}
                    </TD>
                    <TD className="text-slate-600">
                      {formatDate(submission.submittedAt)}
                    </TD>
                    <TD className="text-slate-600">
                      {formatAge(submission.stageChangedAt)}
                    </TD>
                    <TD className="text-right text-slate-600">
                      {submission.placement ? (
                        <span className="font-medium text-emerald-700">
                          {formatMoney(
                            submission.placement.placementValue,
                            symbol,
                          )}
                          <div className="text-xs font-normal text-slate-500">
                            joined {formatDate(submission.joiningDate)}
                          </div>
                        </span>
                      ) : (
                        '—'
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>

            {hidden > 0 ? (
              <p className="text-xs text-slate-500">
                {hidden} further submission{hidden === 1 ? '' : 's'} for this
                candidate {hidden === 1 ? 'is' : 'are'} outside your scope.
              </p>
            ) : null}
          </div>
        )}
      </Card>

      <Card
        title="Activity"
        description="Screening calls and notes about the person. What a specific client said lives on the submission."
        actions={
          canManageActivity ? (
            <ActivityForm parent={{ kind: 'candidate', id: candidate.id }} />
          ) : null
        }
      >
        <Timeline
          entries={candidate.activities}
          canManage={canManageActivity}
        />
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
