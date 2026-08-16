import { prisma } from '@/lib/db'
import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { clientVisibilityFilter } from '@/lib/visibility'
import { formatDate } from '@/lib/format'
import { AccessDenied } from '@/components/access-denied'
import { ButtonLink } from '@/components/ui/button'
import { ActiveBadge } from '@/components/ui/badge'
import { Input, Select } from '@/components/ui/field'
import { PageHeader, EmptyState } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'

export const metadata = { title: 'Clients · Sales CRM' }

type SearchParams = Promise<{
  q?: string
  country?: string
  owner?: string
  status?: string
}>

/**
 * How many rows one page of the list shows.
 *
 * There is no pagination control yet — the filters are the way to narrow a
 * list, and at the assumed volumes (open question Q5) most filtered lists fit.
 * The cap exists so an unfiltered list on a large database is slow to read
 * rather than slow to load, and the footer says plainly when it has truncated.
 */
const PAGE_SIZE = 100

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.LEAD_VIEW)
  if (!viewer) return <AccessDenied what="clients" />

  const { q, country, owner, status } = await searchParams
  const search = q?.trim() ?? ''

  const where = {
    isDeleted: false,

    // Both clauses are disjunctions, so they have to be nested under `AND`
    // rather than spread into the same object — a second `OR` key would
    // replace the visibility scope and show every client on file.
    AND: [
      await clientVisibilityFilter(viewer),
      ...(search
        ? [
            {
              OR: [
                { companyName: { contains: search, mode: 'insensitive' as const } },
                { clientCode: { contains: search, mode: 'insensitive' as const } },
                { website: { contains: search, mode: 'insensitive' as const } },
                {
                  contacts: {
                    some: {
                      OR: [
                        { name: { contains: search, mode: 'insensitive' as const } },
                        { email: { contains: search, mode: 'insensitive' as const } },
                        { phone: { contains: search } },
                      ],
                    },
                  },
                },
              ],
            },
          ]
        : []),
    ],
    ...(country ? { countryId: country } : {}),
    ...(owner ? { ownerId: owner } : {}),
    ...(status === 'active'
      ? { isActive: true }
      : status === 'inactive'
        ? { isActive: false }
        : {}),
  }

  const [clients, total, countries, owners] = await Promise.all([
    prisma.client.findMany({
      where,
      select: {
        id: true,
        clientCode: true,
        companyName: true,
        industry: true,
        city: true,
        isActive: true,
        createdAt: true,
        country: { select: { name: true } },
        owner: { select: { name: true } },
        contacts: {
          where: { isActive: true },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          take: 1,
          select: { name: true, email: true },
        },
        _count: { select: { leads: { where: { isDeleted: false } } } },
      },
      orderBy: { companyName: 'asc' },
      take: PAGE_SIZE,
    }),
    prisma.client.count({ where }),
    prisma.country.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findMany({
      // Only people who actually own a client: a hundred-name dropdown where
      // ninety of them return nothing is a filter nobody uses.
      where: { isActive: true, clientsOwned: { some: { isDeleted: false } } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  return (
    <div className="space-y-5">
      <PageHeader
        title="Clients"
        description="One company, many opportunities. A returning customer gets a new lead against the same account, never a second company record."
        actions={<ButtonLink href="/clients/new">Add client</ButtonLink>}
      />

      <form className="flex flex-wrap items-end gap-2" method="get">
        <div className="min-w-56 flex-1">
          <label htmlFor="q" className="sr-only">
            Search clients
          </label>
          <Input
            id="q"
            name="q"
            defaultValue={search}
            placeholder="Search company, code, website or contact"
          />
        </div>

        <div>
          <label htmlFor="country" className="sr-only">
            Country
          </label>
          <Select id="country" name="country" defaultValue={country ?? ''}>
            <option value="">All countries</option>
            {countries.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label htmlFor="owner" className="sr-only">
            Owner
          </label>
          <Select id="owner" name="owner" defaultValue={owner ?? ''}>
            <option value="">All owners</option>
            {owners.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label htmlFor="status" className="sr-only">
            Status
          </label>
          <Select id="status" name="status" defaultValue={status ?? ''}>
            <option value="">Active and inactive</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </Select>
        </div>

        <ButtonLink href="/clients" variant="ghost">
          Clear
        </ButtonLink>
        <button
          type="submit"
          className="h-9 rounded-md border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Apply
        </button>
      </form>

      {clients.length === 0 ? (
        <EmptyState>
          {total === 0 && !search
            ? 'No clients yet. Add one, or create a lead — the lead form can create the client with it.'
            : 'No clients match these filters.'}
        </EmptyState>
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Company</TH>
                <TH>Primary contact</TH>
                <TH>Location</TH>
                <TH>Owner</TH>
                <TH className="text-right">Leads</TH>
                <TH>Added</TH>
                <TH>Status</TH>
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
                      {client.industry ? ` · ${client.industry}` : ''}
                    </div>
                  </TD>
                  <TD className="text-slate-600">
                    {client.contacts[0]?.name ?? '—'}
                    {client.contacts[0]?.email ? (
                      <div className="text-xs text-slate-500">
                        {client.contacts[0].email}
                      </div>
                    ) : null}
                  </TD>
                  <TD className="text-slate-600">
                    {client.country?.name ?? '—'}
                    {client.city ? (
                      <div className="text-xs text-slate-500">{client.city}</div>
                    ) : null}
                  </TD>
                  <TD className="text-slate-600">{client.owner?.name ?? '—'}</TD>
                  <TD className="text-right text-slate-600">
                    {client._count.leads}
                  </TD>
                  <TD className="text-slate-600">{formatDate(client.createdAt)}</TD>
                  <TD>
                    <ActiveBadge active={client.isActive} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>

          <p className="text-xs text-slate-500">
            Showing {clients.length} of {total} clients
            {total > PAGE_SIZE ? ' — narrow the filters to see the rest' : ''}.
          </p>
        </>
      )}
    </div>
  )
}
