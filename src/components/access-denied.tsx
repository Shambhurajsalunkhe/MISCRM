import { ButtonLink } from '@/components/ui/button'

/**
 * Rendered by a page whose `pageAccess` guard returned null. Says what is
 * missing without leaking anything about the records behind the screen.
 */
export function AccessDenied({ what = 'this screen' }: { what?: string }) {
  return (
    <div className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white px-6 py-10 text-center">
      <h1 className="text-base font-semibold text-slate-900">
        You don&apos;t have access to {what}
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        Your role does not include this capability. An administrator can grant
        it from the role permission matrix.
      </p>
      <ButtonLink href="/" variant="secondary" className="mt-5">
        Back to dashboard
      </ButtonLink>
    </div>
  )
}
