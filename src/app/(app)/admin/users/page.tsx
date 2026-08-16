import { prisma } from '@/lib/db'
import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { ROLE_ORDER, ROLE_SHORT_LABELS } from '@/lib/roles'
import type { UserRole } from '@/generated/prisma/enums'
import { AccessDenied } from '@/components/access-denied'
import { ButtonLink } from '@/components/ui/button'
import { ActiveBadge, Badge } from '@/components/ui/badge'
import { Input, Select } from '@/components/ui/field'
import { PageHeader, EmptyState } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { UserActiveToggle } from './user-active-toggle'

export const metadata = { title: 'Users · Sales CRM' }

type SearchParams = Promise<{ q?: string; role?: string; status?: string }>

function isRole(value: string | undefined): value is UserRole {
  return ROLE_ORDER.includes(value as UserRole)
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const viewer = await pageAccess(PERMISSIONS.ADMIN_USERS)
  if (!viewer) return <AccessDenied what="user administration" />

  const { q, role, status } = await searchParams
  const search = q?.trim() ?? ''

  const users = await prisma.user.findMany({
    where: {
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
              {
                employeeCode: {
                  contains: search,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
      ...(isRole(role) ? { role } : {}),
      ...(status === 'active'
        ? { isActive: true }
        : status === 'inactive'
          ? { isActive: false }
          : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      designation: true,
      isActive: true,
      lastLoginAt: true,
      department: { select: { name: true } },
      team: { select: { name: true } },
      reportingManager: { select: { name: true } },
    },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  })

  const total = await prisma.user.count()

  return (
    <div className="space-y-5">
      <PageHeader
        title="Users"
        description="Roles, reporting lines and access. Deactivating someone keeps their history intact and stops them signing in immediately."
        actions={<ButtonLink href="/admin/users/new">Add user</ButtonLink>}
      />

      {/* A plain GET form: filters end up in the URL, so a filtered list can be
          bookmarked and shared, and the back button behaves. */}
      <form className="flex flex-wrap items-end gap-2" method="get">
        <div className="min-w-56 flex-1">
          <label htmlFor="q" className="sr-only">
            Search users
          </label>
          <Input
            id="q"
            name="q"
            defaultValue={search}
            placeholder="Search name, email or employee code"
          />
        </div>

        <div>
          <label htmlFor="role" className="sr-only">
            Role
          </label>
          <Select id="role" name="role" defaultValue={role ?? ''}>
            <option value="">All roles</option>
            {ROLE_ORDER.map((value) => (
              <option key={value} value={value}>
                {ROLE_SHORT_LABELS[value]}
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

        <ButtonLink href="/admin/users" variant="ghost">
          Clear
        </ButtonLink>
        <button
          type="submit"
          className="h-9 rounded-md border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Apply
        </button>
      </form>

      {users.length === 0 ? (
        <EmptyState>
          No users match these filters.{' '}
          {total > 0 ? 'Clear them to see all users.' : null}
        </EmptyState>
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Role</TH>
                <TH>Department / team</TH>
                <TH>Reports to</TH>
                <TH>Last sign-in</TH>
                <TH>Status</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {users.map((user) => (
                <TR key={user.id}>
                  <TD>
                    <a
                      href={`/admin/users/${user.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {user.name}
                    </a>
                    <div className="text-xs text-slate-500">{user.email}</div>
                  </TD>
                  <TD>
                    <Badge tone={user.role === 'ADMIN' ? 'info' : 'neutral'}>
                      {ROLE_SHORT_LABELS[user.role]}
                    </Badge>
                    {user.designation ? (
                      <div className="mt-0.5 text-xs text-slate-500">
                        {user.designation}
                      </div>
                    ) : null}
                  </TD>
                  <TD className="text-slate-600">
                    {user.department?.name ?? '—'}
                    {user.team ? (
                      <div className="text-xs text-slate-500">
                        {user.team.name}
                      </div>
                    ) : null}
                  </TD>
                  <TD className="text-slate-600">
                    {user.reportingManager?.name ?? '—'}
                  </TD>
                  <TD className="text-slate-600">
                    {user.lastLoginAt
                      ? user.lastLoginAt.toLocaleDateString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })
                      : 'Never'}
                  </TD>
                  <TD>
                    <ActiveBadge active={user.isActive} />
                  </TD>
                  <TD>
                    <div className="flex justify-end gap-1">
                      <ButtonLink
                        href={`/admin/users/${user.id}`}
                        variant="ghost"
                        size="sm"
                      >
                        Edit
                      </ButtonLink>
                      <UserActiveToggle
                        id={user.id}
                        name={user.name}
                        isActive={user.isActive}
                        isSelf={user.id === viewer.id}
                      />
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>

          <p className="text-xs text-slate-500">
            Showing {users.length} of {total} users.
          </p>
        </>
      )}
    </div>
  )
}
