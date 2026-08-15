import { LoginForm } from '@/app/login/login-form'

export const metadata = {
  title: 'Sign in · Sales CRM',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Sales CRM
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Multi-vertical sales management
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <LoginForm next={next} />
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          DigiMantra Sales CRM
        </p>
      </div>
    </main>
  )
}
