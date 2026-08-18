import { prisma } from '@/lib/db'
import { can } from '@/lib/authz'
import { requireUser } from '@/lib/auth/session'
import { PERMISSIONS } from '@/lib/permissions'
import { Card } from '@/components/ui/page'
import { ActivityForm } from '@/components/activity/activity-form'
import { Timeline } from '@/components/activity/timeline'
import { loadRequirement } from '../requirement'

type Params = Promise<{ id: string }>

/**
 * The requirement's own chronological record.
 *
 * Separate from the lead's timeline on purpose: a client engagement and a
 * specific role are two different conversations, and folding the second into
 * the first would bury "shared three profiles for the Java role" under account
 * chatter. Stage moves on this requirement and on every submission under it
 * land here, which is what makes this the one place to catch up on a role.
 */
export default async function RequirementTimelinePage({
  params,
}: {
  params: Params
}) {
  const viewer = await requireUser()
  const { id } = await params
  const requirement = await loadRequirement(viewer, id)

  const [activities, canManage] = await Promise.all([
    prisma.activity.findMany({
      // History only. A planned call is an arrangement, not something that
      // happened, and listing it here would date it in the past tense.
      where: { requirementId: requirement.id, isPlanned: false },
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
      take: 200,
    }),
    can(viewer, PERMISSIONS.ACTIVITY_MANAGE),
  ])

  return (
    <Card
      title="Timeline"
      description="Calls, notes and every stage move on this requirement and its submissions."
      actions={
        canManage ? (
          <ActivityForm parent={{ kind: 'requirement', id: requirement.id }} />
        ) : null
      }
    >
      <Timeline entries={activities} canManage={canManage} />
    </Card>
  )
}
