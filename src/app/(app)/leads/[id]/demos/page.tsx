import { prisma } from '@/lib/db'
import { can } from '@/lib/authz'
import { requireUser } from '@/lib/auth/session'
import { PERMISSIONS } from '@/lib/permissions'
import { formatDateTime, toDateTimeInputValue } from '@/lib/format'
import {
  DEMO_STATUS_LABELS,
  DEMO_STATUS_TONES,
} from '@/lib/commercials/display'
import { Badge } from '@/components/ui/badge'
import { Card, EmptyState } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { RowAction } from '@/components/row-action'
import { loadLead } from '../lead'
import { deleteDemoAction } from './actions'
import { DemoForm } from './demo-form'
import { DemoOutcome } from './demo-outcome'

type Params = Promise<{ id: string }>

export const metadata = { title: 'Demos · Sales CRM' }

/**
 * The Product Sales tab of the lead detail screen (docs/03 §1).
 *
 * Decision D11 made visible: one lead holds several demos, which is the only
 * shape in which your dashboard's *120 demos against 60 leads* is arithmetic
 * rather than a contradiction. The two counts at the top of the tab are the
 * numerators of docs/02 §4.6 — Demos Scheduled is every row, Demos Completed is
 * the ones that actually ran — so the funnel percentages can be checked against
 * a single lead rather than only in aggregate.
 */
export default async function LeadDemosPage({ params }: { params: Params }) {
  const viewer = await requireUser()
  const { id } = await params
  const lead = await loadLead(viewer, id)

  if (!lead.vertical.usesDemos) {
    return (
      <Card title="Demos">
        <EmptyState>
          {lead.vertical.name} leads do not carry demos. The module is a switch
          on the vertical in Master Data, so this tab appears wherever it is
          turned on.
        </EmptyState>
      </Card>
    )
  }

  // Resolved before the batch below rather than inside it: the pickers are only
  // fetched for someone who can use them, and a promise in a ternary is always
  // truthy.
  const canManage = await can(viewer, PERMISSIONS.ACTIVITY_MANAGE)

  const [demos, products, users] = await Promise.all([
    prisma.demo.findMany({
      where: { leadId: lead.id },
      select: {
        id: true,
        scheduledAt: true,
        completedAt: true,
        status: true,
        attendees: true,
        feedback: true,
        notes: true,
        product: { select: { name: true } },
        conductedBy: { select: { name: true } },
      },
      orderBy: { scheduledAt: 'desc' },
    }),
    canManage
      ? prisma.product.findMany({
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
    canManage
      ? prisma.user.findMany({
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
  ])

  const completed = demos.filter((demo) => demo.status === 'COMPLETED').length

  return (
    <Card
      title="Demos"
      description={`${demos.length} scheduled · ${completed} completed. A Product Sales lead can hold as many demos as it takes — recording one never moves the lead's stage.`}
      actions={
        canManage ? (
          <DemoForm
            leadId={lead.id}
            products={products}
            users={users}
            defaultConductedById={viewer.id}
          />
        ) : null
      }
    >
      {demos.length === 0 ? (
        <EmptyState>
          No demos yet. Book the first one from the button above.
        </EmptyState>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>When</TH>
              <TH>Product</TH>
              <TH>Conducted by</TH>
              <TH>Attendees</TH>
              <TH>Status</TH>
              <TH>Feedback</TH>
              {canManage ? (
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              ) : null}
            </TR>
          </THead>
          <TBody>
            {demos.map((demo) => (
              <TR key={demo.id}>
                <TD>
                  <div className="font-medium text-slate-900">
                    {formatDateTime(demo.scheduledAt)}
                  </div>
                  {demo.completedAt ? (
                    <div className="text-xs text-slate-500">
                      Ran {formatDateTime(demo.completedAt)}
                    </div>
                  ) : null}
                </TD>
                <TD className="text-slate-600">{demo.product?.name ?? '—'}</TD>
                <TD className="text-slate-600">
                  {demo.conductedBy?.name ?? 'Unassigned'}
                </TD>
                <TD className="max-w-48 truncate text-slate-600">
                  {demo.attendees ?? '—'}
                </TD>
                <TD>
                  <Badge tone={DEMO_STATUS_TONES[demo.status]}>
                    {DEMO_STATUS_LABELS[demo.status]}
                  </Badge>
                </TD>
                <TD className="max-w-64 text-xs text-slate-600">
                  {demo.feedback ?? demo.notes ?? '—'}
                </TD>
                {canManage ? (
                  <TD>
                    <div className="flex items-start gap-1">
                      <DemoOutcome
                        demoId={demo.id}
                        status={demo.status}
                        scheduledAt={toDateTimeInputValue(demo.scheduledAt)}
                        feedback={demo.feedback}
                      />
                      <RowAction
                        action={deleteDemoAction}
                        id={demo.id}
                        label="Remove"
                        confirmMessage="Remove this demo? It stops counting in Demos Scheduled."
                      />
                    </div>
                  </TD>
                ) : null}
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  )
}
