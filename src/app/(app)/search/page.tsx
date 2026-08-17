import { prisma } from '@/lib/db'
import { can, pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import {
  clientVisibilityFilter,
  leadChildVisibilityFilter,
  leadVisibilityFilter,
  requirementVisibilityFilter,
} from '@/lib/visibility'
import type { CurrentUser } from '@/lib/auth/session'
import {
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUS_TONES,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  QUOTATION_STATUS_LABELS,
  QUOTATION_STATUS_TONES,
} from '@/lib/commercials/display'
import { displayStatus } from '@/lib/commercials/overdue'
import { normalisePhone } from '@/lib/dedupe'
import { formatDate } from '@/lib/format'
import { LEAD_STATUS_LABELS, LEAD_STATUS_TONES } from '@/lib/leads/display'
import {
  fillLabel,
  REQUIREMENT_STATUS_LABELS,
  REQUIREMENT_STATUS_TONES,
} from '@/lib/staffing/display'
import { AccessDenied } from '@/components/access-denied'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Input } from '@/components/ui/field'
import { Card, EmptyState, PageHeader } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'

export const metadata = { title: 'Search · Sales CRM' }

type SearchParams = Promise<{ q?: string }>

/** Per section. Enough to recognise the right record without a second page. */
const LIMIT = 25

/**
 * Global search (README §30).
 *
 * Covers lead code, client, contact name, email, phone, website, LinkedIn,
 * requirements, the candidate master and — from Phase 5 — quotation, contract
 * and invoice numbers. Between them, the identifiers someone actually has in
 * front of them when a call comes in, including the client ringing about a
 * document number they are reading off a PDF.
 *
 * Every query is scoped through the same visibility helpers the lists use.
 * Search is where scope leaks are easiest to introduce and hardest to notice:
 * an unscoped query here would let anyone confirm a competitor's account exists
 * by typing its name, without ever opening a record.
 */
type CommercialHit = {
  href: string
  number: string
  kind: 'Quotation' | 'Contract' | 'Invoice'
  status: string
  tone: BadgeTone
  companyName: string
  leadId: string
  leadCode: string
}

/**
 * Quotation, contract and invoice numbers.
 *
 * Matched on the document number only — not on client or lead, which the
 * sections above already cover. A search for "Acme" that returned every invoice
 * Acme has ever had would bury the account itself under its own paperwork.
 *
 * Invoice status is the *derived* one, so a document that fell due overnight
 * reads as overdue here for the same reason it does on the register (see
 * src/lib/commercials/overdue.ts).
 */
async function findCommercials(
  viewer: CurrentUser,
  term: string,
): Promise<CommercialHit[]> {
  const insensitive = { contains: term, mode: 'insensitive' as const }
  const scope = await leadChildVisibilityFilter(viewer)
  const lead = {
    select: {
      id: true,
      leadCode: true,
      client: { select: { companyName: true } },
    },
  }

  const [quotations, contracts, invoices] = await Promise.all([
    prisma.quotation.findMany({
      where: { ...scope, quoteNumber: insensitive },
      select: { id: true, quoteNumber: true, status: true, lead },
      take: LIMIT,
    }),
    prisma.contract.findMany({
      where: { ...scope, contractNumber: insensitive },
      select: { id: true, contractNumber: true, status: true, lead },
      take: LIMIT,
    }),
    prisma.invoice.findMany({
      where: { ...scope, invoiceNumber: insensitive },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        totalAmount: true,
        amountReceived: true,
        dueDate: true,
        lead,
      },
      take: LIMIT,
    }),
  ])

  const now = new Date()

  return [
    ...quotations.map((row) => ({
      href: `/quotations/${row.id}`,
      number: row.quoteNumber,
      kind: 'Quotation' as const,
      status: QUOTATION_STATUS_LABELS[row.status],
      tone: QUOTATION_STATUS_TONES[row.status],
      companyName: row.lead.client.companyName,
      leadId: row.lead.id,
      leadCode: row.lead.leadCode,
    })),
    ...contracts.map((row) => ({
      href: `/contracts/${row.id}`,
      number: row.contractNumber,
      kind: 'Contract' as const,
      status: CONTRACT_STATUS_LABELS[row.status],
      tone: CONTRACT_STATUS_TONES[row.status],
      companyName: row.lead.client.companyName,
      leadId: row.lead.id,
      leadCode: row.lead.leadCode,
    })),
    ...invoices.map((row) => {
      const shown = displayStatus(row, now)
      return {
        href: `/invoices/${row.id}`,
        number: row.invoiceNumber,
        kind: 'Invoice' as const,
        status: INVOICE_STATUS_LABELS[shown],
        tone: INVOICE_STATUS_TONES[shown],
        companyName: row.lead.client.companyName,
        leadId: row.lead.id,
        leadCode: row.lead.leadCode,
      }
    }),
  ].slice(0, LIMIT)
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.LEAD_VIEW)
  if (!viewer) return <AccessDenied what="search" />

  const { q } = await searchParams
  const term = q?.trim() ?? ''

  // Two characters is where a prefix search stops being a search and starts
  // being "the first page of everything".
  const tooShort = term.length > 0 && term.length < 2

  const insensitive = { contains: term, mode: 'insensitive' as const }
  // Someone reading a number off a screen types it differently every time, so
  // the search term is reduced to the same normalised form the contact row
  // stores. Comparing against the formatted `phone` column matched nothing.
  const phone = normalisePhone(term)

  // The staffing sections are gated separately rather than riding on
  // `lead.view`. A role someone can open and a person in the candidate master
  // are two different capabilities in docs/03 §2, and a search result is a way
  // into a record — so it has to answer to the same permission the screen
  // behind it does.
  const [canSeeStaffing, canSeeCandidates, canSeeCommercials] =
    await Promise.all([
      can(viewer, PERMISSIONS.STAFFING_REQUIREMENT_MANAGE),
      can(viewer, PERMISSIONS.STAFFING_CANDIDATE_MANAGE),
      can(viewer, PERMISSIONS.COMMERCIAL_MANAGE),
    ])

  const [leads, clients, contacts, requirements, candidates] =
    term.length >= 2
      ? await Promise.all([
          prisma.lead.findMany({
            where: {
              isDeleted: false,
              // `AND`, not a spread beside an `OR` key — see the note in
              // src/app/(app)/leads/filters.ts. Search is the worst place to
              // get this wrong: it is the one screen that will happily match a
              // record the user was never meant to know exists.
              AND: [
                await leadVisibilityFilter(viewer),
                {
                  OR: [
                    { leadCode: insensitive },
                    { title: insensitive },
                    { client: { companyName: insensitive } },
                    { referenceUrl: insensitive },
                  ],
                },
              ],
            },
            select: {
              id: true,
              leadCode: true,
              title: true,
              status: true,
              createdAt: true,
              client: { select: { companyName: true } },
              vertical: { select: { name: true } },
              currentStage: { select: { name: true } },
              assignedTo: { select: { name: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: LIMIT,
          }),
          prisma.client.findMany({
            where: {
              isDeleted: false,
              AND: [
                await clientVisibilityFilter(viewer),
                {
                  OR: [
                    { companyName: insensitive },
                    { clientCode: insensitive },
                    { website: insensitive },
                    { companyLinkedIn: insensitive },
                  ],
                },
              ],
            },
            select: {
              id: true,
              clientCode: true,
              companyName: true,
              website: true,
              country: { select: { name: true } },
              owner: { select: { name: true } },
              _count: { select: { leads: { where: { isDeleted: false } } } },
            },
            orderBy: { companyName: 'asc' },
            take: LIMIT,
          }),
          prisma.clientContact.findMany({
            where: {
              client: {
                isDeleted: false,
                ...(await clientVisibilityFilter(viewer)),
              },
              OR: [
                { name: insensitive },
                { email: insensitive },
                { linkedInProfile: insensitive },
                ...(phone ? [{ phoneNormalised: phone }] : []),
              ],
            },
            select: {
              id: true,
              name: true,
              designation: true,
              email: true,
              phone: true,
              isActive: true,
              client: { select: { id: true, companyName: true } },
            },
            orderBy: { name: 'asc' },
            take: LIMIT,
          }),
          // Requirements, which README §30 names explicitly. Scoped through
          // `requirementVisibilityFilter` rather than the lead filter: a role
          // handed to another team's recruiter is theirs, and a search that
          // matched it would confirm a named company is hiring.
          canSeeStaffing
            ? prisma.requirement.findMany({
                where: {
                  isDeleted: false,
                  AND: [
                    await requirementVisibilityFilter(viewer),
                    {
                      OR: [
                        { requirementCode: insensitive },
                        { position: insensitive },
                        { skills: insensitive },
                        { client: { companyName: insensitive } },
                      ],
                    },
                  ],
                },
                select: {
                  id: true,
                  requirementCode: true,
                  position: true,
                  status: true,
                  openings: true,
                  positionsFilled: true,
                  client: { select: { companyName: true } },
                  currentStage: { select: { name: true } },
                  assignedTo: { select: { name: true } },
                },
                orderBy: { createdAt: 'desc' },
                take: LIMIT,
              })
            : Promise.resolve([]),
          // Candidates carry no data scope — the master is shared by decision
          // D9 — so the permission is the whole gate. See
          // src/app/(app)/candidates/filters.ts.
          canSeeCandidates
            ? prisma.candidate.findMany({
                where: {
                  isDeleted: false,
                  OR: [
                    { fullName: insensitive },
                    { candidateCode: insensitive },
                    { email: insensitive },
                    { primarySkills: insensitive },
                    { currentEmployer: insensitive },
                    ...(phone ? [{ phoneNormalised: phone }] : []),
                  ],
                },
                select: {
                  id: true,
                  candidateCode: true,
                  fullName: true,
                  email: true,
                  primarySkills: true,
                  currentLocation: true,
                  totalExperienceYears: true,
                  isActive: true,
                },
                orderBy: { fullName: 'asc' },
                take: LIMIT,
              })
            : Promise.resolve([]),
        ])
      : [[], [], [], [], []]

  // Quotation, contract and invoice numbers, in one section rather than three.
  // Somebody typing `INV-0042` has a document in front of them and does not
  // need to be asked which register it lives in; three near-empty cards would
  // be the same information laid out worse.
  const commercials =
    canSeeCommercials && term.length >= 2 ? await findCommercials(viewer, term) : []

  const totalHits =
    leads.length +
    clients.length +
    contacts.length +
    requirements.length +
    candidates.length +
    commercials.length

  return (
    <div className="space-y-5">
      <PageHeader
        title="Search"
        description="Lead code, company, contact, requirement, candidate, quotation, contract or invoice — by name, code, email, phone, skill, website or LinkedIn."
      />

      <form className="flex max-w-xl gap-2" method="get">
        <label htmlFor="q" className="sr-only">
          Search
        </label>
        <Input
          id="q"
          name="q"
          defaultValue={term}
          placeholder="UP-0001, REQ-0007, INV-0042, Acme, jane@acme.com, Kafka, +1 415…"
          autoFocus
        />
        <button
          type="submit"
          className="h-9 shrink-0 rounded-md bg-slate-900 px-3.5 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          Search
        </button>
      </form>

      {term === '' ? (
        <EmptyState>Type something to search for.</EmptyState>
      ) : tooShort ? (
        <EmptyState>Enter at least two characters.</EmptyState>
      ) : totalHits === 0 ? (
        <EmptyState>
          Nothing matches “{term}” in the records you can see.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {leads.length > 0 ? (
            <Card title={`Leads (${leads.length}${leads.length === LIMIT ? '+' : ''})`}>
              <Table>
                <THead>
                  <TR>
                    <TH>Lead</TH>
                    <TH>Client</TH>
                    <TH>Vertical</TH>
                    <TH>Stage</TH>
                    <TH>Assigned to</TH>
                    <TH>Created</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {leads.map((lead) => (
                    <TR key={lead.id}>
                      <TD>
                        <a
                          href={`/leads/${lead.id}`}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {lead.leadCode}
                        </a>
                        <div className="max-w-64 truncate text-xs text-slate-500">
                          {lead.title}
                        </div>
                      </TD>
                      <TD className="text-slate-600">
                        {lead.client.companyName}
                      </TD>
                      <TD className="text-slate-600">{lead.vertical.name}</TD>
                      <TD className="text-slate-600">
                        {lead.currentStage?.name ?? '—'}
                      </TD>
                      <TD className="text-slate-600">
                        {lead.assignedTo?.name ?? 'Unassigned'}
                      </TD>
                      <TD className="text-slate-600">
                        {formatDate(lead.createdAt)}
                      </TD>
                      <TD>
                        <Badge tone={LEAD_STATUS_TONES[lead.status]}>
                          {LEAD_STATUS_LABELS[lead.status]}
                        </Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          ) : null}

          {clients.length > 0 ? (
            <Card
              title={`Clients (${clients.length}${clients.length === LIMIT ? '+' : ''})`}
            >
              <Table>
                <THead>
                  <TR>
                    <TH>Company</TH>
                    <TH>Website</TH>
                    <TH>Country</TH>
                    <TH>Owner</TH>
                    <TH className="text-right">Leads</TH>
                  </TR>
                </THead>
                <TBody>
                  {clients.map((client) => (
                    <TR key={client.id}>
                      <TD>
                        <a
                          href={`/clients/${client.id}`}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {client.companyName}
                        </a>
                        <div className="text-xs text-slate-500">
                          {client.clientCode}
                        </div>
                      </TD>
                      <TD className="text-slate-600">{client.website ?? '—'}</TD>
                      <TD className="text-slate-600">
                        {client.country?.name ?? '—'}
                      </TD>
                      <TD className="text-slate-600">
                        {client.owner?.name ?? '—'}
                      </TD>
                      <TD className="text-right text-slate-600">
                        {client._count.leads}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          ) : null}

          {contacts.length > 0 ? (
            <Card
              title={`Contacts (${contacts.length}${contacts.length === LIMIT ? '+' : ''})`}
            >
              <Table>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>Company</TH>
                    <TH>Email</TH>
                    <TH>Phone</TH>
                  </TR>
                </THead>
                <TBody>
                  {contacts.map((contact) => (
                    <TR key={contact.id}>
                      <TD>
                        <span className="font-medium text-slate-900">
                          {contact.name}
                        </span>
                        {contact.isActive ? null : (
                          <Badge className="ml-2">Inactive</Badge>
                        )}
                        {contact.designation ? (
                          <div className="text-xs text-slate-500">
                            {contact.designation}
                          </div>
                        ) : null}
                      </TD>
                      <TD>
                        <a
                          href={`/clients/${contact.client.id}`}
                          className="text-slate-700 hover:underline"
                        >
                          {contact.client.companyName}
                        </a>
                      </TD>
                      <TD className="text-slate-600">{contact.email ?? '—'}</TD>
                      <TD className="text-slate-600">{contact.phone ?? '—'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          ) : null}

          {requirements.length > 0 ? (
            <Card
              title={`Requirements (${requirements.length}${requirements.length === LIMIT ? '+' : ''})`}
            >
              <Table>
                <THead>
                  <TR>
                    <TH>Requirement</TH>
                    <TH>Client</TH>
                    <TH>Stage</TH>
                    <TH className="text-right">Openings</TH>
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
                      <TD className="text-slate-600">
                        {requirement.client.companyName}
                      </TD>
                      <TD className="text-slate-600">
                        {requirement.currentStage?.name ?? '—'}
                      </TD>
                      <TD className="text-right tabular-nums text-slate-600">
                        {fillLabel(
                          requirement.openings,
                          requirement.positionsFilled,
                        )}
                      </TD>
                      <TD className="text-slate-600">
                        {requirement.assignedTo?.name ?? 'Unassigned'}
                      </TD>
                      <TD>
                        <Badge
                          tone={REQUIREMENT_STATUS_TONES[requirement.status]}
                        >
                          {REQUIREMENT_STATUS_LABELS[requirement.status]}
                        </Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          ) : null}

          {commercials.length > 0 ? (
            <Card
              title={`Commercial documents (${commercials.length}${commercials.length === LIMIT ? '+' : ''})`}
            >
              <Table>
                <THead>
                  <TR>
                    <TH>Document</TH>
                    <TH>Kind</TH>
                    <TH>Client</TH>
                    <TH>Lead</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {commercials.map((row) => (
                    <TR key={row.href}>
                      <TD>
                        <a
                          href={row.href}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {row.number}
                        </a>
                      </TD>
                      <TD className="text-slate-600">{row.kind}</TD>
                      <TD className="text-slate-600">{row.companyName}</TD>
                      <TD>
                        <a
                          href={`/leads/${row.leadId}`}
                          className="text-slate-700 hover:underline"
                        >
                          {row.leadCode}
                        </a>
                      </TD>
                      <TD>
                        <Badge tone={row.tone}>{row.status}</Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          ) : null}

          {candidates.length > 0 ? (
            <Card
              title={`Candidates (${candidates.length}${candidates.length === LIMIT ? '+' : ''})`}
            >
              <Table>
                <THead>
                  <TR>
                    <TH>Candidate</TH>
                    <TH>Skills</TH>
                    <TH className="text-right">Experience</TH>
                    <TH>Location</TH>
                    <TH>Email</TH>
                  </TR>
                </THead>
                <TBody>
                  {candidates.map((candidate) => (
                    <TR key={candidate.id}>
                      <TD>
                        <a
                          href={`/candidates/${candidate.id}`}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {candidate.fullName}
                        </a>
                        {candidate.isActive ? null : (
                          <Badge className="ml-2">Retired</Badge>
                        )}
                        <div className="text-xs text-slate-500">
                          {candidate.candidateCode}
                        </div>
                      </TD>
                      <TD className="max-w-64 truncate text-slate-600">
                        {candidate.primarySkills ?? '—'}
                      </TD>
                      <TD className="text-right tabular-nums text-slate-600">
                        {candidate.totalExperienceYears
                          ? `${candidate.totalExperienceYears.toString()} yrs`
                          : '—'}
                      </TD>
                      <TD className="text-slate-600">
                        {candidate.currentLocation ?? '—'}
                      </TD>
                      <TD className="text-slate-600">
                        {candidate.email ?? '—'}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  )
}
