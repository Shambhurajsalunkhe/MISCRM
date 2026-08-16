import { notFound } from 'next/navigation'

import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { AccessDenied } from '@/components/access-denied'
import { ActiveToggle } from '@/components/active-toggle'
import { ActiveBadge } from '@/components/ui/badge'
import { ButtonLink } from '@/components/ui/button'
import { Card, PageHeader } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { setMasterActiveAction } from '../actions'
import { MasterRowForm } from '../master-row-form'
import { masterEntity, type SelectOption } from '../registry'

/**
 * Every row on this page is per-request: the master list itself, and the
 * permission check that decides whether the visitor may see it. There is
 * nothing to prerender, so no `generateStaticParams` — offering one would let
 * Next build a static shell for a screen that must never be served from cache.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ entity: string }>
}) {
  const entity = masterEntity((await params).entity)
  return { title: `${entity?.title ?? 'Master data'} · Sales CRM` }
}

export default async function MasterListPage({
  params,
  searchParams,
}: {
  params: Promise<{ entity: string }>
  searchParams: Promise<{ edit?: string }>
}) {
  const viewer = await pageAccess(PERMISSIONS.ADMIN_MASTER)
  if (!viewer) return <AccessDenied what="master data" />

  const entity = masterEntity((await params).entity)
  if (!entity) notFound()

  const { edit } = await searchParams

  const [rows, options] = await Promise.all([
    entity.list(),
    entity.loadOptions?.() ?? Promise.resolve<Record<string, SelectOption[]>>({}),
  ])

  // Every field, plus the status, usage and action columns.
  const columnCount = entity.fields.length + 3
  const addingNew = edit === 'new'

  return (
    <div className="space-y-5">
      <PageHeader
        title={entity.title}
        description={entity.description}
        actions={
          <>
            <ButtonLink href="/admin/master" variant="secondary">
              All master data
            </ButtonLink>
            {addingNew ? null : (
              <ButtonLink href={`/admin/master/${entity.slug}?edit=new`}>
                Add {entity.noun}
              </ButtonLink>
            )}
          </>
        }
      />

      <Card>
        <div className="space-y-3">
          {addingNew ? (
            <MasterRowForm
              slug={entity.slug}
              fields={entity.fields}
              options={options}
            />
          ) : null}

          {rows.length === 0 && !addingNew ? (
            <p className="text-sm text-slate-500">
              No {entity.title.toLowerCase()} yet.
            </p>
          ) : (
            <Table>
              <THead>
                <TR>
                  {entity.fields.map((field) => (
                    <TH key={field.name}>{field.label}</TH>
                  ))}
                  <TH>In use</TH>
                  <TH>Status</TH>
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </TR>
              </THead>

              <TBody>
                {rows.map((row) => (
                  <TR key={row.id}>
                    {edit === row.id ? (
                      <TD colSpan={columnCount}>
                        <MasterRowForm
                          slug={entity.slug}
                          fields={entity.fields}
                          options={options}
                          row={row}
                          columnCount={columnCount}
                        />
                      </TD>
                    ) : (
                      <>
                        {entity.fields.map((field, index) => (
                          <TD
                            key={field.name}
                            className={
                              index === 0 ? 'font-medium text-slate-900' : 'text-slate-600'
                            }
                          >
                            {/* A `select` shows the resolved label the list
                                query supplied, not the raw id. */}
                            {field.type === 'select'
                              ? (row.values[`_${field.name.replace(/Id$/, '')}Label`] ??
                                row.values[field.name] ??
                                '—')
                              : (row.values[field.name] || '—')}
                          </TD>
                        ))}
                        <TD className="text-slate-500">{row.usage}</TD>
                        <TD>
                          <ActiveBadge active={row.isActive} />
                        </TD>
                        <TD>
                          <div className="flex justify-end gap-1">
                            <ButtonLink
                              href={`/admin/master/${entity.slug}?edit=${row.id}`}
                              variant="ghost"
                              size="sm"
                            >
                              Edit
                            </ButtonLink>
                            <ActiveToggle
                              action={setMasterActiveAction}
                              id={row.id}
                              isActive={row.isActive}
                              hidden={{ entity: entity.slug }}
                              confirmMessage={
                                row.isActive
                                  ? `Deactivate this ${entity.noun}? It stops appearing in the pickers. Records already using it (${row.usage}) keep it, so historical reports do not change.`
                                  : `Reactivate this ${entity.noun}?`
                              }
                            />
                          </div>
                        </TD>
                      </>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </Card>
    </div>
  )
}
