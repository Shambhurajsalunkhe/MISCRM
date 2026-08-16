import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { can } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { Card } from '@/components/ui/page'
import { ActivityForm } from '@/components/activity/activity-form'
import { Timeline } from '@/components/activity/timeline'
import { loadLead } from '../lead'

type Params = Promise<{ id: string }>

export const metadata = { title: 'Timeline · Sales CRM' }

/**
 * The chronological record for one lead (README §23).
 *
 * Includes the entries the application writes itself — stage changes and
 * assignments — alongside the calls and emails people log. Splitting them into
 * two lists would mean nobody could see that the stage moved the day after the
 * client went quiet, which is exactly the kind of thing this tab is read for.
 */
export default async function LeadTimelinePage({ params }: { params: Params }) {
  const viewer = await requireUser()
  const { id } = await params
  const lead = await loadLead(viewer, id)

  const [activities, canManage] = await Promise.all([
    prisma.activity.findMany({
      where: { leadId: lead.id },
      orderBy: { activityDate: 'desc' },
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
    }),
    can(viewer, PERMISSIONS.ACTIVITY_MANAGE),
  ])

  return (
    <Card
      title="Timeline"
      description="Calls, emails, meetings and notes, newest first — together with the stage and assignment changes the system records itself."
      actions={canManage ? <ActivityForm leadId={lead.id} /> : null}
    >
      <Timeline entries={activities} canManage={canManage} />
    </Card>
  )
}
