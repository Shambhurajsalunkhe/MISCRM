import { requireUser } from '@/lib/auth/session'

export const metadata = {
  title: 'Dashboard · Sales CRM',
}

export default async function DashboardPage() {
  const user = await requireUser()

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Signed in as {user.name}
        </p>
      </header>

      <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
        <p className="text-sm font-medium text-slate-700">
          The Sales Head dashboard arrives in Phase 6.
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
          Phases 0 and 1 deliver authentication, roles, teams and master data.
          KPI cards, vertical breakdowns and the pipeline chart are built once
          lead and revenue data exists.
        </p>
      </div>
    </div>
  )
}
