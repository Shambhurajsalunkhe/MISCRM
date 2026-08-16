'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { prisma } from '@/lib/db'
import { verifyPassword } from '@/lib/auth/password'
import { createSession, destroySession } from '@/lib/auth/session'
import { recordAudit } from '@/lib/audit/record'

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(3),
  password: z.string().min(1),
  next: z.string().optional(),
})

export type LoginState = { error: string | null }

/**
 * A real bcrypt hash (cost 12) of a random string nobody holds.
 *
 * When the email is unknown or the account is deactivated we still run one
 * bcrypt comparison against this, so every failed login costs the same ~250ms
 * regardless of whether the address exists. Without it, an unknown address
 * returns in single-digit milliseconds and the response time alone enumerates
 * valid accounts — the identical error message is not sufficient on its own.
 */
const DUMMY_PASSWORD_HASH =
  '$2b$12$qYo5K2W.voBb3IqTb8LiKuRMrg9mQnIf7vfoHFDQQO.TxGjhlW9Zu'

/**
 * True only for same-origin relative paths.
 *
 * `//evil.com` and `/\evil.com` are both protocol-relative once the browser
 * normalises backslashes, so a lone `startsWith('/')` check is an open
 * redirect. Reject anything whose second character opens an authority.
 */
function isSafeRedirectTarget(value: string | undefined): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    value[1] !== '/' &&
    value[1] !== '\\'
  )
}

export async function loginAction(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  // `formData.get` returns null for absent fields, and Zod's `.optional()`
  // accepts undefined but not null — so normalise before parsing. The `next`
  // field is only rendered when the user was redirected from a protected page.
  const parsed = loginSchema.safeParse({
    email: formData.get('email') ?? undefined,
    password: formData.get('password') ?? undefined,
    next: formData.get('next') ?? undefined,
  })

  if (!parsed.success) {
    return { error: 'Enter your email address and password.' }
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      passwordHash: true,
      isActive: true,
    },
  })

  // Deliberately identical message for unknown email, wrong password and
  // deactivated account — nothing here should confirm whether an address
  // exists in the system.
  const invalid = { error: 'Invalid email address or password.' }

  // Always exactly one bcrypt comparison, so the timing of a failure does not
  // reveal whether the address is registered. Do not short-circuit above this.
  const passwordMatches = await verifyPassword(
    parsed.data.password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  )

  if (!user || !user.isActive || !passwordMatches) return invalid

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  })

  // Explicit, because the ORM-layer writer only sees row changes and
  // `lastLoginAt` is deliberately ignored there — otherwise every sign-in
  // would produce a field-diff row saying a timestamp moved, which buries the
  // sign-in itself.
  await recordAudit({
    entityType: 'USER',
    entityId: user.id,
    action: 'LOGIN',
    userId: user.id,
  })

  await createSession({
    sub: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  })

  redirect(isSafeRedirectTarget(parsed.data.next) ? parsed.data.next : '/')
}

export async function logoutAction(): Promise<void> {
  await destroySession()
  redirect('/login')
}
