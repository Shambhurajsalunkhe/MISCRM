import { prisma } from '@/lib/db'
import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { ROLE_SHORT_LABELS } from '@/lib/roles'
import { clientVisibilityFilter } from '@/lib/visibility'
import { leadFormLayout } from '@/lib/leads/vertical-form'
import { recentCounterBatches } from '@/lib/prospecting/source-link'
import { AccessDenied } from '@/components/access-denied'
import { EmptyState, PageHeader } from '@/components/ui/page'
import { LeadForm, type LeadFormClient } from './lead-form'

export const metadata = { title: 'New lead · Sales CRM' }

type SearchParams = Promise<{ vertical?: string; clientId?: string }>

/**
 * How many clients the picker offers.
 *
 * Ordered most-recent-first so the cap bites on dormant accounts rather than
 * the ones people are actually working. Past this, the route in is the client
 * page's own "New lead" button, which arrives here with `?clientId=` already
 * set — the form says so under the picker.
 */
const CLIENT_PICKER_LIMIT = 500

export default async function NewLeadPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.LEAD_CREATE)
  if (!viewer) return <AccessDenied what="lead creation" />

  const { vertical: verticalParam, clientId } = await searchParams

  const verticals = await prisma.salesVertical.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      code: true,
      name: true,
      usesRequirements: true,
      usesCandidates: true,
      usesDemos: true,
      usesQuotations: true,
      usesContracts: true,
      usesInvoicing: true,
    },
  })

  if (verticals.length === 0) {
    return (
      <div className="max-w-3xl space-y-5">
        <PageHeader title="New lead" />
        <EmptyState>
          No active verticals. An administrator needs to enable at least one in
          Master Data before leads can be created.
        </EmptyState>
      </div>
    )
  }

  // An unknown or inactive `?vertical=` falls back to the first rather than
  // erroring: a stale bookmark should still let someone create a lead.
  const vertical =
    verticals.find((row) => row.id === verticalParam) ?? verticals[0]

  const [sources, services, products, countries, users, sourceActivities, clients] =
    await Promise.all([
      // Sources are either global or scoped to one vertical, and the picker
      // must offer both — a global "Referral" applies everywhere.
      prisma.leadSource.findMany({
        where: {
          isActive: true,
          OR: [{ verticalId: null }, { verticalId: vertical.id }],
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.service.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.product.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.country.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, name: true, role: true },
        orderBy: { name: 'asc' },
      }),
      // Empty for Product Sales and Other Sources, which count nothing above
      // the line — the picker then simply does not render.
      recentCounterBatches(viewer, vertical.id),
      prisma.client.findMany({
        where: {
          isDeleted: false,
          isActive: true,
          ...(await clientVisibilityFilter(viewer)),
        },
        select: {
          id: true,
          clientCode: true,
          companyName: true,
          contacts: {
            where: { isActive: true },
            orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
            select: { id: true, name: true, designation: true, isPrimary: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: CLIENT_PICKER_LIMIT + 1,
      }),
    ])

  const truncated = clients.length > CLIENT_PICKER_LIMIT
  const capped = clients.slice(0, CLIENT_PICKER_LIMIT)

  // "New lead" on a client page arrives with `?clientId=`. If that account is
  // older than the most recent 500 it falls outside the query above, and the
  // pre-selection was silently dropped — leaving the user on a blank picker
  // with no hint that the button had done anything. Fetch it separately, under
  // the same visibility and active constraints, and add it to the list.
  if (clientId && !capped.some((client) => client.id === clientId)) {
    const requested = await prisma.client.findFirst({
      where: {
        id: clientId,
        isDeleted: false,
        isActive: true,
        ...(await clientVisibilityFilter(viewer)),
      },
      select: {
        id: true,
        clientCode: true,
        companyName: true,
        contacts: {
          where: { isActive: true },
          orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
          select: { id: true, name: true, designation: true, isPrimary: true },
        },
      },
    })

    if (requested) capped.push(requested)
  }

  const clientOptions: LeadFormClient[] = capped
    .map((client) => ({
      id: client.id,
      label: `${client.companyName} · ${client.clientCode}`,
      contacts: client.contacts.map((contact) => ({
        id: contact.id,
        label: contact.designation
          ? `${contact.name} — ${contact.designation}`
          : contact.name,
        isPrimary: contact.isPrimary,
      })),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="New lead"
        description="A lead code is issued on save, and the lead starts at the first stage of its vertical."
      />

      <LeadForm
        layout={leadFormLayout(vertical)}
        verticalId={vertical.id}
        defaultClientId={
          clientOptions.some((client) => client.id === clientId)
            ? clientId
            : undefined
        }
        options={{
          verticals: verticals.map(({ id, name }) => ({ id, name })),
          sources,
          services,
          products,
          countries,
          users: users.map((user) => ({
            id: user.id,
            name: user.name,
            roleLabel: ROLE_SHORT_LABELS[user.role],
          })),
          clients: clientOptions,
          clientsTruncated: truncated,
          sourceActivities,
        }}
      />
    </div>
  )
}
