import { prisma } from '@/lib/db'
import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { clientVisibilityFilter, leadVisibilityFilter } from '@/lib/visibility'
import { formatDate } from '@/lib/format'
import { LEAD_STATUS_LABELS, LEAD_STATUS_TONES } from '@/lib/leads/display'
import { AccessDenied } from '@/components/access-denied'
import { Badge } from '@/components/ui/badge'
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
 * Covers lead code, client, contact name, email, phone, website and LinkedIn —
 * the identifiers someone actually has in front of them when a call comes in.
 *
 * Every query is scoped through the same visibility helpers the lists use.
 * Search is where scope leaks are easiest to introduce and hardest to notice:
 * an unscoped query here would let anyone confirm a competitor's account exists
 * by typing its name, without ever opening a record.
 */
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
  // Phone numbers are stored as typed, so match on digits alone: someone
  // reading a number off a screen types it differently every time.
  const digits = term.replace(/\D/g, '')

  const [leads, clients, contacts] =
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
                ...(digits.length >= 5 ? [{ phone: { contains: digits } }] : []),
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
        ])
      : [[], [], []]

  const totalHits = leads.length + clients.length + contacts.length

  return (
    <div className="space-y-5">
      <PageHeader
        title="Search"
        description="Lead code, company, contact name, email, phone, website or LinkedIn."
      />

      <form className="flex max-w-xl gap-2" method="get">
        <label htmlFor="q" className="sr-only">
          Search
        </label>
        <Input
          id="q"
          name="q"
          defaultValue={term}
          placeholder="UP-0001, Acme, jane@acme.com, +1 415…"
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
        </div>
      )}
    </div>
  )
}
