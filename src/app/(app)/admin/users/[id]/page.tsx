import { notFound } from 'next/navigation'

import { prisma } from '@/lib/db'
import { pageAccess } from '@/lib/authz'
import { PERMISSIONS } from '@/lib/permissions'
import { ROLE_LABELS } from '@/lib/roles'
import { AccessDenied } from '@/components/access-denied'
import { ActiveBadge } from '@/components/ui/badge'
import { Card, PageHeader } from '@/components/ui/page'
import { updateUserAction } from '../actions'
import { loadUserFormOptions } from '../options'
import { UserForm } from '../user-form'
import { ResetPasswordForm } from './reset-password-form'

export const metadata = { title: 'Edit user · Sales CRM' }

export default async function EditUserPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const viewer = await pageAccess(PERMISSIONS.ADMIN_USERS)
  if (!viewer) return <AccessDenied what="user administration" />

  const { id } = await params

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      employeeCode: true,
      designation: true,
      phone: true,
      departmentId: true,
      teamId: true,
      reportingManagerId: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
      _count: {
        select: {
          directReports: true,
          generatedLeads: true,
          assignedLeads: true,
        },
      },
    },
  })

  if (!user) notFound()

  const options = await loadUserFormOptions()

  return (
    <div className="space-y-5">
      <PageHeader
        title={user.name}
        description={`${ROLE_LABELS[user.role]} · joined ${user.createdAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`}
        actions={<ActiveBadge active={user.isActive} />}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <Card title="Profile and access">
          <UserForm
            action={updateUserAction}
            options={options}
            user={{
              ...user,
              // The form takes plain strings; the row carries enums and dates.
              role: user.role,
            }}
            submitLabel="Save changes"
          />
        </Card>

        <div className="space-y-5">
          <Card title="Activity">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Last sign-in</dt>
                <dd className="text-slate-900">
                  {user.lastLoginAt
                    ? user.lastLoginAt.toLocaleString('en-GB')
                    : 'Never'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Direct reports</dt>
                <dd className="text-slate-900">{user._count.directReports}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Leads generated</dt>
                <dd className="text-slate-900">{user._count.generatedLeads}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Leads assigned</dt>
                <dd className="text-slate-900">{user._count.assignedLeads}</dd>
              </div>
            </dl>
            <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
              Lead counts stay attached to this account permanently — that is
              why deactivating replaces deleting.
            </p>
          </Card>

          <Card
            title="Reset password"
            description="Sets a new password immediately. The old one stops working."
          >
            <ResetPasswordForm id={user.id} />
          </Card>
        </div>
      </div>
    </div>
  )
}
