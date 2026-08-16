import 'server-only'

import { headers } from 'next/headers'
import { unstable_rethrow } from 'next/navigation'

import { requirePermission } from '@/lib/authz'
import { withAuditActor } from '@/lib/audit/context'
import type { CurrentUser } from '@/lib/auth/session'
import type { Permission } from '@/lib/permissions'
import { isAuthenticationError, isAuthorizationError } from '@/lib/errors'
import { actionError, type ActionState } from '@/lib/form'

/**
 * The standard wrapper for a mutating server action.
 *
 * It does three jobs that are wrong to get wrong individually:
 *
 *  1. Checks the permission *before* the body runs. `requirePermission` throws,
 *     so a forgotten `if` cannot leave the action open.
 *  2. Establishes the audit actor for everything the body writes, so the ORM
 *     extension can attribute rows without any call site passing a user id.
 *  3. Converts thrown auth errors into an `ActionState` the form can render,
 *     rather than a 500 page.
 *
 * Unexpected errors are logged server-side and reported generically — a Prisma
 * constraint message can name columns and tables, which does not belong in a
 * user-facing string.
 */
export async function withAudit(
  permission: Permission,
  body: (user: CurrentUser) => Promise<ActionState>,
): Promise<ActionState> {
  let user: CurrentUser

  try {
    user = await requirePermission(permission)
  } catch (error) {
    if (isAuthenticationError(error)) {
      return actionError('Your session has expired. Sign in again.')
    }
    if (isAuthorizationError(error)) {
      return actionError('You do not have permission to do that.')
    }
    throw error
  }

  const headerList = await headers()

  return withAuditActor(
    {
      userId: user.id,
      // `x-forwarded-for` is a list when the request crossed more than one
      // proxy; the first entry is the client. It is only as trustworthy as the
      // proxy in front of the app, which is why it is a log field and never an
      // access-control input.
      ipAddress:
        headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        headerList.get('x-real-ip'),
      userAgent: headerList.get('user-agent'),
    },
    async () => {
      try {
        return await body(user)
      } catch (error) {
        // `redirect()` and `notFound()` work by throwing, and so does the
        // dynamic-rendering bailout. `unstable_rethrow` lets those through and
        // returns for everything else.
        unstable_rethrow(error)

        console.error(`[action] ${permission} failed`, error)
        return actionError('Something went wrong. Please try again.')
      }
    },
  )
}
