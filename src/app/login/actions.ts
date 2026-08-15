'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { prisma } from '@/lib/db'
import { verifyPassword } from '@/lib/auth/password'
import { createSession, destroySession } from '@/lib/auth/session'

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(3),
  password: z.string().min(1),
  next: z.string().optional(),
})

export type LoginState = { error: string | null }

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

  if (!user || !user.isActive) return invalid

  const passwordMatches = await verifyPassword(
    parsed.data.password,
    user.passwordHash,
  )
  if (!passwordMatches) return invalid

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  })

  await createSession({
    sub: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  })

  // Only allow same-origin relative paths, so `?next=` cannot be used to
  // bounce a freshly signed-in user off to another site.
  const target =
    parsed.data.next && parsed.data.next.startsWith('/') &&
    !parsed.data.next.startsWith('//')
      ? parsed.data.next
      : '/'

  redirect(target)
}

export async function logoutAction(): Promise<void> {
  await destroySession()
  redirect('/login')
}
