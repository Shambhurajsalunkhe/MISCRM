import { can } from '@/lib/authz'
import { requireUser } from '@/lib/auth/session'
import { PERMISSIONS } from '@/lib/permissions'
import { currencySymbol } from '@/lib/settings'
import { toDateInputValue } from '@/lib/format'
import { AccessDenied } from '@/components/access-denied'
import { PageHeader } from '@/components/ui/page'
import { activeUserOptions, requirementTypeOptions } from '../../options'
import { RequirementForm } from '../../requirement-form'
import { loadRequirement } from '../requirement'

type Params = Promise<{ id: string }>

export const metadata = { title: 'Edit requirement · Sales CRM' }

export default async function EditRequirementPage({
  params,
}: {
  params: Params
}) {
  const viewer = await requireUser()
  const { id } = await params

  // The layout already gates this route on the candidate permission, which is
  // the weaker of the two. Editing the requirement itself needs the stronger
  // one, so it is checked again here rather than assumed from having got in.
  if (!(await can(viewer, PERMISSIONS.STAFFING_REQUIREMENT_MANAGE))) {
    return <AccessDenied what="editing staffing requirements" />
  }

  const requirement = await loadRequirement(viewer, id)

  const [types, people, symbol] = await Promise.all([
    requirementTypeOptions(),
    activeUserOptions(),
    currencySymbol(),
  ])

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Edit ${requirement.requirementCode}`}
        description="The lead this belongs to is fixed at creation — moving it would leave its placements booked against one account and its submissions discussed on another."
      />

      <RequirementForm
        mode="edit"
        requirementId={requirement.id}
        types={types}
        people={people}
        currencySymbol={symbol}
        cancelHref={`/requirements/${requirement.id}`}
        values={{
          position: requirement.position,
          requirementTypeId: requirement.requirementTypeId ?? '',
          openings: String(requirement.openings),
          skills: requirement.skills ?? '',
          // Decimal to string rather than through Number(), so 4.5 round-trips
          // without picking up a float's tail.
          minExperience: requirement.minExperience?.toString() ?? '',
          maxExperience: requirement.maxExperience?.toString() ?? '',
          location: requirement.location ?? '',
          workMode: requirement.workMode ?? '',
          budgetMin: requirement.budgetMin?.toString() ?? '',
          budgetMax: requirement.budgetMax?.toString() ?? '',
          targetDate: toDateInputValue(requirement.targetDate),
          priority: requirement.priority,
          description: requirement.description ?? '',
          assignedToId: requirement.assignedToId ?? '',
        }}
      />
    </div>
  )
}
