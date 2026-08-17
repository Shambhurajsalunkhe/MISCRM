import { notFound } from 'next/navigation'

import { prisma } from '@/lib/db'
import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import {
  AccessDenied,
  STAFFING_ACCESS_REASON,
} from '@/components/access-denied'
import { PageHeader } from '@/components/ui/page'
import { CandidateForm } from '../../candidate-form'

type Params = Promise<{ id: string }>

export const metadata = { title: 'Edit candidate · Sales CRM' }

export default async function EditCandidatePage({ params }: { params: Params }) {
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
    },
  })

  if (!candidate) notFound()

  const symbol = await currencySymbol()

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Edit ${candidate.fullName}`}
        description={`${candidate.candidateCode}. Changes apply to every requirement this profile has been submitted to.`}
      />

      <CandidateForm
        mode="edit"
        candidateId={candidate.id}
        cancelHref={`/candidates/${candidate.id}`}
        currencySymbol={symbol}
        values={{
          fullName: candidate.fullName,
          email: candidate.email ?? '',
          phone: candidate.phone ?? '',
          currentLocation: candidate.currentLocation ?? '',
          preferredLocation: candidate.preferredLocation ?? '',
          // Decimal to string rather than through Number(), so 6.5 round-trips
          // without picking up a float's tail.
          totalExperienceYears: candidate.totalExperienceYears?.toString() ?? '',
          primarySkills: candidate.primarySkills ?? '',
          currentEmployer: candidate.currentEmployer ?? '',
          currentCtc: candidate.currentCtc?.toString() ?? '',
          expectedCtc: candidate.expectedCtc?.toString() ?? '',
          noticePeriodDays:
            candidate.noticePeriodDays != null
              ? String(candidate.noticePeriodDays)
              : '',
          linkedInProfile: candidate.linkedInProfile ?? '',
          sourceChannel: candidate.sourceChannel ?? '',
          notes: candidate.notes ?? '',
        }}
      />
    </div>
  )
}
