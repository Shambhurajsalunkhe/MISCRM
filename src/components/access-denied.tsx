import { ButtonLink } from '@/components/ui/button'

/**
 * Why a staffing screen is closed. Named here so all ten of them say the same
 * thing, and say the thing that is actually true — the block is almost always
 * the team flag rather than a missing tick in the matrix.
 */
export const STAFFING_ACCESS_REASON =
  'Staffing is worked by one team. An administrator can add you to that team, or flag yours for staffing, under Teams.'

/**
 * Rendered by a page whose `pageAccess` guard returned null. Says what is
 * missing without leaking anything about the records behind the screen.
 */
export function AccessDenied({
  what = 'this screen',
  reason,
}: {
  what?: string
  /**
   * Overrides the default explanation. Worth setting wherever the capability is
   * fenced by something other than the permission matrix — otherwise the screen
   * sends the user to an administrator who will look at the matrix, find the
   * tick already there, and have nothing to change.
   */
  reason?: string
}) {
  return (
    <div className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white px-6 py-10 text-center">
      <h1 className="text-base font-semibold text-slate-900">
        You don&apos;t have access to {what}
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        {reason ??
          'Your role does not include this capability. An administrator can grant it from the role permission matrix.'}
      </p>
      <ButtonLink href="/" variant="secondary" className="mt-5">
        Back to dashboard
      </ButtonLink>
    </div>
  )
}
