import { SignJWT, jwtVerify } from 'jose'
import type { UserRole } from '@/generated/prisma/enums'

/**
 * Edge-safe JWT helpers.
 *
 * This module is imported by `src/middleware.ts`, which runs on the edge
 * runtime. It therefore reads `process.env.AUTH_SECRET` directly (statically
 * inlinable by Next.js) rather than importing `@/env`, and uses `jose` rather
 * than any Node-only crypto.
 */

export const SESSION_COOKIE = 'dmcrm_session'
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12 // 12 hours

export type SessionPayload = {
  sub: string
  name: string
  email: string
  role: UserRole
}

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      'AUTH_SECRET is missing or shorter than 32 characters. See .env.example.',
    )
  }
  return new TextEncoder().encode(secret)
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({
    name: payload.name,
    email: payload.email,
    role: payload.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSecretKey())
}

/** Returns the payload, or null if the token is absent, tampered with or expired. */
export async function verifySession(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: ['HS256'],
    })

    if (
      typeof payload.sub !== 'string' ||
      typeof payload.name !== 'string' ||
      typeof payload.email !== 'string' ||
      typeof payload.role !== 'string'
    ) {
      return null
    }

    return {
      sub: payload.sub,
      name: payload.name,
      email: payload.email,
      role: payload.role as UserRole,
    }
  } catch {
    return null
  }
}
