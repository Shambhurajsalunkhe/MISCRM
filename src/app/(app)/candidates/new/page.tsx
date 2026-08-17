import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import {
  AccessDenied,
  STAFFING_ACCESS_REASON,
} from '@/components/access-denied'
import { PageHeader } from '@/components/ui/page'
import { CandidateForm } from '../candidate-form'

export const metadata = { title: 'Add candidate · Sales CRM' }

export default async function NewCandidatePage() {
  const viewer = await pageAccess(PERMISSIONS.STAFFING_CANDIDATE_MANAGE)
  if (!viewer)
    return (
      <AccessDenied
        what="the candidate master"
        reason={STAFFING_ACCESS_REASON}
      />
    )

  const symbol = await currencySymbol()

  return (
    <div className="space-y-5">
      <PageHeader
        title="Add candidate"
        description="One row per person, however many clients they are put forward for. Search the master first — a duplicate profile counts the same person twice in Candidates Sourced."
      />

      <CandidateForm
        mode="create"
        cancelHref="/candidates"
        currencySymbol={symbol}
      />
    </div>
  )
}
