import 'server-only'

import { cache } from 'react'
import { cookies } from 'next/headers'

import { prisma } from '@/lib/db'
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  signSession,
  verifySession,
  type SessionPayload,
} from '@/lib/auth/jwt'
import { env } from '@/env'
import { AuthenticationError } from '@/lib/errors'

export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await signSession(payload)
  const cookieStore = await cookies()

  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)
}

async function readSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies()
  return verifySession(cookieStore.get(SESSION_COOKIE)?.value)
}

/**
 * The signed-in user, loaded fresh from the database.
 *
 * The JWT is only used to identify *who* is asking. Role, team and active
 * status are always read from the database so that deactivating a user or
 * changing their role takes effect on their next request rather than when
 * their token happens to expire.
 *
 * `cache()` dedupes this to one query per request.
 */
export const getCurrentUser = cache(async () => {
  const session = await readSession()
  if (!session) return null

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      designation: true,
      avatarUrl: true,
      isActive: true,
      teamId: true,
      departmentId: true,
      verticalId: true,
      // The code, not just the id: the staffing fence and the lead form both
      // ask which vertical this is, and joining for it on every request to
      // learn a two-letter string would be a query per page.
      vertical: { select: { id: true, code: true, name: true } },
      reportingManagerId: true,
    },
  })

  if (!user || !user.isActive) return null

  return user
})

export type CurrentUser = NonNullable<
  Awaited<ReturnType<typeof getCurrentUser>>
>

/** Use in server components and actions that must not be reached anonymously. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) {
    throw new AuthenticationError()
  }
  return user
}
