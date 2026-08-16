import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/auth/session'
import { can } from '@/lib/authz'
import { NAVIGATION, type NavSection } from '@/lib/navigation'
import { SidebarNav } from '@/components/sidebar-nav'
import { logoutAction } from '@/app/login/actions'
import { ROLE_LABELS } from '@/lib/roles'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()

  // Middleware already redirects anonymous requests; this covers the case
  // where a session is valid but the account was deactivated mid-session.
  if (!user) redirect('/login')

  // Build the sidebar from what this user may actually reach, so nobody is
  // shown a link that will bounce them.
  const sections: NavSection[] = []
  for (const section of NAVIGATION) {
    const items = []
    for (const item of section.items) {
      if (!item.permission || (await can(user, item.permission))) {
        items.push(item)
      }
    }
    if (items.length > 0) sections.push({ ...section, items })
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="flex w-60 shrink-0 flex-col bg-slate-900">
        <div className="px-5 py-5">
          <p className="text-sm font-semibold text-white">Sales CRM</p>
          <p className="text-xs text-slate-400">DigiMantra</p>
        </div>

        <SidebarNav sections={sections} />

        <div className="border-t border-slate-800 px-3 py-3">
          <p className="truncate px-2 text-sm font-medium text-white">
            {user.name}
          </p>
          <p className="truncate px-2 text-xs text-slate-400">
            {ROLE_LABELS[user.role]}
          </p>
          <form action={logoutAction} className="mt-2">
            <button
              type="submit"
              className="w-full rounded-md px-2 py-1.5 text-left text-sm text-slate-300 transition hover:bg-slate-800 hover:text-white"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 px-8 py-6">{children}</main>
      </div>
    </div>
  )
}
