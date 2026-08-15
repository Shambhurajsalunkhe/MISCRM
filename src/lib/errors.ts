import type { Permission } from '@/lib/permissions'

/**
 * Typed auth failures.
 *
 * These were previously thrown as `new Error('UNAUTHENTICATED')` and
 * `new Error('FORBIDDEN: ...')`, which forced callers to match on message
 * text — brittle, and easy to conflate with an unrelated error that happens
 * to contain the same word. Distinguishing the two cases matters: an
 * unauthenticated request should be redirected to sign in, a forbidden one
 * should not.
 */
export class AuthenticationError extends Error {
  readonly code = 'UNAUTHENTICATED' as const

  constructor(message = 'Authentication required.') {
    super(message)
    this.name = 'AuthenticationError'
  }
}

export class AuthorizationError extends Error {
  readonly code = 'FORBIDDEN' as const
  /** The capability that was missing, preserved for logging and messaging. */
  readonly permission: Permission

  constructor(permission: Permission, message?: string) {
    super(message ?? `Missing required permission: ${permission}`)
    this.name = 'AuthorizationError'
    this.permission = permission
  }
}

export function isAuthenticationError(
  error: unknown,
): error is AuthenticationError {
  return error instanceof AuthenticationError
}

export function isAuthorizationError(
  error: unknown,
): error is AuthorizationError {
  return error instanceof AuthorizationError
}
