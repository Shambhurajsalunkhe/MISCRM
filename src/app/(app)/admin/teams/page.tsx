import { prisma } from '@/lib/db'
import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { MANAGERIAL_ROLES, ROLE_SHORT_LABELS } from '@/lib/roles'
import { AccessDenied } from '@/components/access-denied'
import { ActiveToggle } from '@/components/active-toggle'
import { ActiveBadge } from '@/components/ui/badge'
import { ButtonLink } from '@/components/ui/button'
import { Card, PageHeader } from '@/components/ui/page'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { setDepartmentActiveAction, setTeamActiveAction } from './actions'
import { DepartmentForm } from './department-form'
import { ReportingHierarchy } from './hierarchy'
import { TeamForm } from './team-form'

export const metadata = { title: 'Teams · Sales CRM' }

/**
 * `?edit=dept:new`, `?edit=dept:<id>`, `?edit=team:new`, `?edit=team:<id>`.
 * Keeping edit state in the URL is what lets this whole screen stay a server
 * component — see the note in department-form.tsx.
 */
function parseEdit(edit: string | undefined, prefix: 'dept' | 'team') {
  if (!edit?.startsWith(`${prefix}:`)) return null
  return edit.slice(prefix.length + 1)
}

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>
}) {
  const viewer = await pageAccess(PERMISSIONS.ADMIN_USERS)
  if (!viewer) return <AccessDenied what="team administration" />

  const { edit } = await searchParams
  const editingDepartment = parseEdit(edit, 'dept')
  const editingTeam = parseEdit(edit, 'team')

  const [departments, teams, managers, hierarchyUsers] = await Promise.all([
    prisma.department.findMany({
      select: {
        id: true,
        name: true,
        isActive: true,
        _count: { select: { users: true, teams: true } },
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    }),
    prisma.team.findMany({
      select: {
        id: true,
        name: true,
        isActive: true,
        departmentId: true,
        managerId: true,
        department: { select: { name: true } },
        manager: { select: { name: true } },
        _count: { select: { members: true } },
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    }),
    prisma.user.findMany({
      where: { isActive: true, role: { in: MANAGERIAL_ROLES } },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        role: true,
        isActive: true,
        reportingManagerId: true,
        team: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    }),
  ])

  const activeDepartments = departments
    .filter((department) => department.isActive)
    .map((department) => ({ id: department.id, name: department.name }))

  const managerOptions = managers.map((manager) => ({
    id: manager.id,
    name: manager.name,
    roleLabel: ROLE_SHORT_LABELS[manager.role],
  }))

  /**
   * The pickers list only active departments and active managerial users. A
   * team whose manager was since deactivated would therefore open with the
   * select falling back to "No manager" — and saving an unrelated rename would
   * silently clear the manager, taking that manager's visibility of the team's
   * leads with it. Add the current assignment back, marked, so the value
   * round-trips.
   */
  function optionsForTeam(team: (typeof teams)[number]) {
    const departmentOptions = [...activeDepartments]
    if (
      team.departmentId &&
      !departmentOptions.some((option) => option.id === team.departmentId)
    ) {
      departmentOptions.unshift({
        id: team.departmentId,
        name: `${team.department?.name ?? 'Unknown'} (inactive)`,
      })
    }

    const teamManagerOptions = [...managerOptions]
    if (
      team.managerId &&
      !teamManagerOptions.some((option) => option.id === team.managerId)
    ) {
      teamManagerOptions.unshift({
        id: team.managerId,
        name: team.manager?.name ?? 'Unknown',
        roleLabel: 'no longer eligible',
      })
    }

    return { departmentOptions, teamManagerOptions }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Teams &amp; departments"
        description="The org structure behind data visibility. A manager sees their own records plus their whole reporting sub-tree, and anyone in a team they manage."
      />

      <Card
        title="Departments"
        description="A grouping above teams. Optional — a team can sit on its own."
        actions={
          editingDepartment === 'new' ? null : (
            <ButtonLink href="/admin/teams?edit=dept:new" size="sm">
              Add department
            </ButtonLink>
          )
        }
      >
        <div className="space-y-3">
          {editingDepartment === 'new' ? <DepartmentForm /> : null}

          {departments.length === 0 && editingDepartment !== 'new' ? (
            <p className="text-sm text-slate-500">
              No departments yet.
            </p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Teams</TH>
                  <TH>Users</TH>
                  <TH>Status</TH>
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {departments.map((department) => (
                  <TR key={department.id}>
                    {editingDepartment === department.id ? (
                      <TD colSpan={5}>
                        <DepartmentForm department={department} />
                      </TD>
                    ) : (
                      <>
                        <TD className="font-medium text-slate-900">
                          {department.name}
                        </TD>
                        <TD>{department._count.teams}</TD>
                        <TD>{department._count.users}</TD>
                        <TD>
                          <ActiveBadge active={department.isActive} />
                        </TD>
                        <TD>
                          <div className="flex justify-end gap-1">
                            <ButtonLink
                              href={`/admin/teams?edit=dept:${department.id}`}
                              variant="ghost"
                              size="sm"
                            >
                              Rename
                            </ButtonLink>
                            <ActiveToggle
                              action={setDepartmentActiveAction}
                              id={department.id}
                              isActive={department.isActive}
                              confirmMessage={
                                department.isActive
                                  ? `Deactivate ${department.name}? It disappears from the pickers. Its ${department._count.users} user(s) and ${department._count.teams} team(s) keep the assignment they already have.`
                                  : `Reactivate ${department.name}?`
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

      <Card
        title="Teams"
        description="A team's manager sees every lead belonging to its members, on top of their own reporting sub-tree."
        actions={
          editingTeam === 'new' ? null : (
            <ButtonLink href="/admin/teams?edit=team:new" size="sm">
              Add team
            </ButtonLink>
          )
        }
      >
        <div className="space-y-3">
          {editingTeam === 'new' ? (
            <TeamForm
              departments={activeDepartments}
              managers={managerOptions}
            />
          ) : null}

          {teams.length === 0 && editingTeam !== 'new' ? (
            <p className="text-sm text-slate-500">No teams yet.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Department</TH>
                  <TH>Manager</TH>
                  <TH>Members</TH>
                  <TH>Status</TH>
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {teams.map((team) => (
                  <TR key={team.id}>
                    {editingTeam === team.id ? (
                      <TD colSpan={6}>
                        <TeamForm
                          team={team}
                          departments={optionsForTeam(team).departmentOptions}
                          managers={optionsForTeam(team).teamManagerOptions}
                        />
                      </TD>
                    ) : (
                      <>
                        <TD className="font-medium text-slate-900">
                          {team.name}
                        </TD>
                        <TD className="text-slate-600">
                          {team.department?.name ?? '—'}
                        </TD>
                        <TD className="text-slate-600">
                          {team.manager?.name ?? (
                            <span className="text-amber-700">Unassigned</span>
                          )}
                        </TD>
                        <TD>{team._count.members}</TD>
                        <TD>
                          <ActiveBadge active={team.isActive} />
                        </TD>
                        <TD>
                          <div className="flex justify-end gap-1">
                            <ButtonLink
                              href={`/admin/teams?edit=team:${team.id}`}
                              variant="ghost"
                              size="sm"
                            >
                              Edit
                            </ButtonLink>
                            <ActiveToggle
                              action={setTeamActiveAction}
                              id={team.id}
                              isActive={team.isActive}
                              confirmMessage={
                                team.isActive
                                  ? `Deactivate ${team.name}? Its ${team._count.members} member(s) keep the team on their profile, so their manager keeps visibility of them.`
                                  : `Reactivate ${team.name}?`
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

      <Card
        title="Reporting hierarchy"
        description="Set each person's reporting manager on their profile."
      >
        <ReportingHierarchy
          users={hierarchyUsers.map((user) => ({
            id: user.id,
            name: user.name,
            role: user.role,
            isActive: user.isActive,
            reportingManagerId: user.reportingManagerId,
            teamName: user.team?.name ?? null,
          }))}
        />
      </Card>
    </div>
  )
}
