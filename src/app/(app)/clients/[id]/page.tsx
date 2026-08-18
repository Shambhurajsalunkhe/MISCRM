import { notFound } from 'next/navigation'

import { prisma } from '@/lib/db'
import { pageAccess } from '@/lib/authz'
import { can } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import {
  clientVisibilityFilter,
  requirementVisibilityFilter,
} from '@/lib/visibility'
import { currencySymbol } from '@/lib/settings'
import { formatDate, formatMoney } from '@/lib/format'
import { AccessDenied } from '@/components/access-denied'
import { ButtonLink } from '@/components/ui/button'
import { ActiveBadge, Badge } from '@/components/ui/badge'
import { Card, PageHeader, EmptyState } from '@/components/ui/page'
import { ExternalLink } from '@/components/ui/external-link'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { ActiveToggle } from '@/components/active-toggle'
import { ActivityForm } from '@/components/activity/activity-form'
import { Timeline } from '@/components/activity/timeline'
import { DocumentTable } from '@/components/documents/document-table'
import { UploadForm } from '@/components/documents/upload-form'
import { LEAD_STATUS_TONES } from '@/lib/leads/display'
import {
  fillLabel,
  REQUIREMENT_STATUS_LABELS,
  REQUIREMENT_STATUS_TONES,
} from '@/lib/staffing/display'
import { ContactForm } from './contact-form'
import { setContactActiveAction } from '../actions'

type Params = Promise<{ id: string }>

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params
  const client = await prisma.client.findUnique({
    where: { id },
    select: { clientName: true },
  })
  return { title: `${client?.clientName ?? 'Client'} · Sales CRM` }
}

export default async function ClientDetailPage({ params }: { params: Params }) {
  const viewer = await pageAccess(PERMISSIONS.LEAD_VIEW)
  if (!viewer) return <AccessDenied what="clients" />

  const { id } = await params

  const client = await prisma.client.findFirst({
    where: { id, isDeleted: false, ...(await clientVisibilityFilter(viewer)) },
    select: {
      id: true,
      clientCode: true,
      clientName: true,
      companyName: true,
      website: true,
      companyLinkedIn: true,
      industry: true,
      city: true,
      address: true,
      isActive: true,
      createdAt: true,
      country: { select: { name: true } },
      owner: { select: { name: true } },
      contacts: {
        orderBy: [{ isActive: 'desc' }, { isPrimary: 'desc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          designation: true,
          email: true,
          phone: true,
          linkedInProfile: true,
          isPrimary: true,
          isActive: true,
        },
      },
      leads: {
        where: { isDeleted: false },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          leadCode: true,
          title: true,
          status: true,
          dealValue: true,
          expectedBudget: true,
          createdAt: true,
          vertical: { select: { name: true } },
          currentStage: { select: { name: true } },
          assignedTo: { select: { name: true } },
        },
      },
      documents: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          fileName: true,
          docType: true,
          description: true,
          sizeBytes: true,
          createdAt: true,
          uploadedBy: { select: { name: true } },
        },
      },
      activities: {
        // History only -- see the lead timeline for why.
        where: { isPlanned: false },
        orderBy: { activityDate: 'desc' },
        take: 50,
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
      },
    },
  })

  // Not found rather than forbidden: a client outside this user's scope must
  // not be distinguishable from one that does not exist.
  if (!client) notFound()

  const [canEdit, canManageActivity, symbol, requirements] = await Promise.all([
    can(viewer, PERMISSIONS.LEAD_EDIT),
    can(viewer, PERMISSIONS.ACTIVITY_MANAGE),
    currencySymbol(),
    prisma.requirement.findMany({
      where: {
        clientId: client.id,
        isDeleted: false,
        ...(await requirementVisibilityFilter(viewer)),
      },
      select: {
        id: true,
        requirementCode: true,
        position: true,
        openings: true,
        positionsFilled: true,
        status: true,
        targetDate: true,
        lead: { select: { id: true, leadCode: true } },
        currentStage: { select: { name: true } },
        assignedTo: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return (
    <div className="space-y-5">
      <PageHeader
        title={client.clientName}
        description={[
          client.clientCode,
          // Only when it says something the title does not — a client recorded
          // under its company name would otherwise print it twice.
          client.companyName !== client.clientName ? client.companyName : null,
          client.industry,
          [client.city, client.country?.name].filter(Boolean).join(', ') || null,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          canEdit ? (
            <>
              <ButtonLink
                href={`/leads/new?clientId=${client.id}`}
                variant="secondary"
              >
                New lead
              </ButtonLink>
              <ButtonLink href={`/clients/${client.id}/edit`}>Edit</ButtonLink>
            </>
          ) : null
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Account" className="lg:col-span-1">
          <dl className="space-y-2 text-sm">
            <Detail label="Status">
              <ActiveBadge active={client.isActive} />
            </Detail>
            <Detail label="Owner">{client.owner?.name ?? 'Unassigned'}</Detail>
            <Detail label="Company">{client.companyName ?? '—'}</Detail>
            <Detail label="Website">
              <ExternalLink href={client.website} />
            </Detail>
            <Detail label="LinkedIn">
              <ExternalLink href={client.companyLinkedIn} />
            </Detail>
            <Detail label="Address">{client.address ?? '—'}</Detail>
            <Detail label="On file since">{formatDate(client.createdAt)}</Detail>
          </dl>
        </Card>

        <Card
          title="Contacts"
          description="One is marked primary; that is the one the lead form pre-selects."
          className="lg:col-span-2"
          actions={
            canEdit ? (
              <ContactForm clientId={client.id} label="Add contact" />
            ) : null
          }
        >
          {client.contacts.length === 0 ? (
            <EmptyState>No contacts yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {client.contacts.map((contact) => (
                <li key={contact.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">
                          {contact.name}
                        </span>
                        {contact.isPrimary ? (
                          <Badge tone="info">Primary</Badge>
                        ) : null}
                        {contact.isActive ? null : <Badge>Inactive</Badge>}
                      </div>
                      {contact.designation ? (
                        <p className="text-xs text-slate-500">
                          {contact.designation}
                        </p>
                      ) : null}
                      <p className="mt-0.5 text-sm text-slate-600">
                        {[contact.email, contact.phone]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </p>
                      {contact.linkedInProfile ? (
                        <p className="text-xs">
                          <ExternalLink href={contact.linkedInProfile} />
                        </p>
                      ) : null}
                    </div>

                    {canEdit ? (
                      <div className="flex items-center gap-1">
                        <ContactForm
                          clientId={client.id}
                          contact={contact}
                          label="Edit"
                        />
                        <ActiveToggle
                          action={setContactActiveAction}
                          id={contact.id}
                          isActive={contact.isActive}
                          confirmMessage={
                            contact.isActive
                              ? `Deactivate ${contact.name}? They stay on every lead that already names them.`
                              : `Reactivate ${contact.name}?`
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Leads"
        description="Every opportunity against this account. A returning customer belongs here, not in a second client record."
      >
        {client.leads.length === 0 ? (
          <EmptyState>No leads against this client yet.</EmptyState>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Lead</TH>
                <TH>Vertical</TH>
                <TH>Stage</TH>
                <TH>Assigned to</TH>
                <TH className="text-right">Value</TH>
                <TH>Created</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {client.leads.map((lead) => (
                <TR key={lead.id}>
                  <TD>
                    <a
                      href={`/leads/${lead.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {lead.leadCode}
                    </a>
                    <div className="text-xs text-slate-500">{lead.title}</div>
                  </TD>
                  <TD className="text-slate-600">{lead.vertical.name}</TD>
                  <TD className="text-slate-600">
                    {lead.currentStage?.name ?? '—'}
                  </TD>
                  <TD className="text-slate-600">
                    {lead.assignedTo?.name ?? 'Unassigned'}
                  </TD>
                  <TD className="text-right text-slate-600">
                    {formatMoney(lead.dealValue ?? lead.expectedBudget, symbol)}
                  </TD>
                  <TD className="text-slate-600">{formatDate(lead.createdAt)}</TD>
                  <TD>
                    <Badge tone={LEAD_STATUS_TONES[lead.status]}>
                      {lead.status}
                    </Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {/* Staffing (docs/03 §1): the client page lists every requirement across
          all of this account's leads, which is the view a recruiter wants and
          the lead-by-lead tabs cannot give. Scoped separately from the client
          itself — being able to see the account does not put every role under
          it inside your scope — and hidden entirely when there are none, so a
          non-staffing account does not carry an empty staffing section. */}
      {requirements.length > 0 ? (
        <Card
          title="Requirements"
          description="Every staffing role across this account's leads."
        >
          <Table>
            <THead>
              <TR>
                <TH>Requirement</TH>
                <TH>Lead</TH>
                <TH>Stage</TH>
                <TH className="text-right">Openings</TH>
                <TH>Target</TH>
                <TH>Owner</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {requirements.map((requirement) => (
                <TR key={requirement.id}>
                  <TD>
                    <a
                      href={`/requirements/${requirement.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {requirement.requirementCode}
                    </a>
                    <div className="max-w-64 truncate text-xs text-slate-500">
                      {requirement.position}
                    </div>
                  </TD>
                  <TD>
                    <a
                      href={`/leads/${requirement.lead.id}`}
                      className="text-slate-700 hover:underline"
                    >
                      {requirement.lead.leadCode}
                    </a>
                  </TD>
                  <TD className="text-slate-600">
                    {requirement.currentStage?.name ?? '—'}
                  </TD>
                  <TD className="text-right tabular-nums text-slate-600">
                    {fillLabel(requirement.openings, requirement.positionsFilled)}
                  </TD>
                  <TD className="text-slate-600">
                    {formatDate(requirement.targetDate)}
                  </TD>
                  <TD className="text-slate-600">
                    {requirement.assignedTo?.name ?? 'Unassigned'}
                  </TD>
                  <TD>
                    <Badge tone={REQUIREMENT_STATUS_TONES[requirement.status]}>
                      {REQUIREMENT_STATUS_LABELS[requirement.status]}
                    </Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Activity"
          description="Account-level history. Activity on a specific opportunity lives on that lead."
          actions={
            canManageActivity ? (
              <ActivityForm parent={{ kind: 'client', id: client.id }} />
            ) : null
          }
        >
          <Timeline entries={client.activities} canManage={canManageActivity} />
        </Card>

        <Card
          title="Documents"
          actions={
            canManageActivity ? (
              <UploadForm parent={{ kind: 'client', id: client.id }} />
            ) : null
          }
        >
          <DocumentTable
            documents={client.documents}
            canManage={canManageActivity}
          />
        </Card>
      </div>
    </div>
  )
}

function Detail({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-slate-800">{children}</dd>
    </div>
  )
}

