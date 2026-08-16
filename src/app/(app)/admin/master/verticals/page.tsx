import { prisma } from '@/lib/db'
import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { AccessDenied } from '@/components/access-denied'
import { ActiveToggle } from '@/components/active-toggle'
import { ActiveBadge, Badge } from '@/components/ui/badge'
import { ButtonLink } from '@/components/ui/button'
import { Card, PageHeader } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { setVerticalActiveAction } from './actions'
import { VerticalForm } from './vertical-form'

export const metadata = { title: 'Verticals · Sales CRM' }

const MODULE_CHIPS = [
  { key: 'usesRequirements', label: 'Requirements' },
  { key: 'usesCandidates', label: 'Candidates' },
  { key: 'usesDemos', label: 'Demos' },
  { key: 'usesQuotations', label: 'Quotations' },
  { key: 'usesContracts', label: 'Contracts' },
  { key: 'usesInvoicing', label: 'Invoicing' },
] as const

export default async function VerticalsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>
}) {
  const viewer = await pageAccess(PERMISSIONS.ADMIN_MASTER)
  if (!viewer) return <AccessDenied what="master data" />

  const { edit } = await searchParams

  const verticals = await prisma.salesVertical.findMany({
    select: {
      id: true,
      name: true,
      code: true,
      leadPrefix: true,
      colorHex: true,
      sortOrder: true,
      isActive: true,
      usesRequirements: true,
      usesCandidates: true,
      usesDemos: true,
      usesQuotations: true,
      usesContracts: true,
      usesInvoicing: true,
      _count: { select: { leads: true, stages: true } },
    },
    orderBy: { sortOrder: 'asc' },
  })

  const editing =
    edit && edit !== 'new'
      ? verticals.find((vertical) => vertical.id === edit)
      : undefined

  return (
    <div className="space-y-5">
      <PageHeader
        title="Verticals"
        description="The eight acquisition channels. The module switches decide which sections a lead of that vertical shows — turning Invoicing off means the vertical reports deal value only, with no collected or pending revenue (decision D6)."
        actions={
          <>
            <ButtonLink href="/admin/master" variant="secondary">
              All master data
            </ButtonLink>
            {/* Keyed off the resolved form, not any truthy `edit` value — a
                stale or mistyped id would otherwise hide the Add button while
                rendering no edit form, leaving the screen with no way out. */}
            {edit === 'new' || editing ? null : (
              <ButtonLink href="/admin/master/verticals?edit=new">
                Add vertical
              </ButtonLink>
            )}
          </>
        }
      />

      {edit === 'new' ? (
        <Card title="New vertical">
          <VerticalForm />
        </Card>
      ) : null}

      {editing ? (
        <Card title={`Edit ${editing.name}`}>
          <VerticalForm
            vertical={{
              id: editing.id,
              name: editing.name,
              code: editing.code,
              leadPrefix: editing.leadPrefix,
              colorHex: editing.colorHex ?? '#64748B',
              sortOrder: editing.sortOrder,
              usesRequirements: editing.usesRequirements,
              usesCandidates: editing.usesCandidates,
              usesDemos: editing.usesDemos,
              usesQuotations: editing.usesQuotations,
              usesContracts: editing.usesContracts,
              usesInvoicing: editing.usesInvoicing,
              leadCount: editing._count.leads,
            }}
          />
        </Card>
      ) : null}

      <Table>
        <THead>
          <TR>
            <TH>Vertical</TH>
            <TH>Prefix</TH>
            <TH>Modules</TH>
            <TH>Stages</TH>
            <TH>Leads</TH>
            <TH>Status</TH>
            <TH>
              <span className="sr-only">Actions</span>
            </TH>
          </TR>
        </THead>

        <TBody>
          {verticals.map((vertical) => (
            <TR key={vertical.id}>
              <TD>
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: vertical.colorHex ?? '#64748B' }}
                  />
                  <span className="font-medium text-slate-900">
                    {vertical.name}
                  </span>
                  <span className="font-mono text-xs text-slate-400">
                    {vertical.code}
                  </span>
                </div>
              </TD>
              <TD className="font-mono text-xs text-slate-600">
                {vertical.leadPrefix}-0001
              </TD>
              <TD>
                <div className="flex flex-wrap gap-1">
                  {MODULE_CHIPS.filter((chip) => vertical[chip.key]).map(
                    (chip) => (
                      <Badge key={chip.key} tone="info">
                        {chip.label}
                      </Badge>
                    ),
                  )}
                  {MODULE_CHIPS.every((chip) => !vertical[chip.key]) ? (
                    <span className="text-xs text-slate-400">
                      Common pipeline only
                    </span>
                  ) : null}
                </div>
              </TD>
              <TD>
                <a
                  href={`/admin/master/stages?vertical=${vertical.id}`}
                  className="text-slate-700 hover:underline"
                >
                  {vertical._count.stages}
                </a>
              </TD>
              <TD className="text-slate-600">{vertical._count.leads}</TD>
              <TD>
                <ActiveBadge active={vertical.isActive} />
              </TD>
              <TD>
                <div className="flex justify-end gap-1">
                  <ButtonLink
                    href={`/admin/master/verticals?edit=${vertical.id}`}
                    variant="ghost"
                    size="sm"
                  >
                    Edit
                  </ButtonLink>
                  <ActiveToggle
                    action={setVerticalActiveAction}
                    id={vertical.id}
                    isActive={vertical.isActive}
                    confirmMessage={
                      vertical.isActive
                        ? `Deactivate ${vertical.name}? No new leads can be created against it. Its ${vertical._count.leads} existing lead(s) stay exactly as they are and still count in reports.`
                        : `Reactivate ${vertical.name}?`
                    }
                  />
                </div>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  )
}
