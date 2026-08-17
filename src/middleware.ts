import { NextResponse, type NextRequest } from 'next/server'

import { SESSION_COOKIE, verifySession } from '@/lib/auth/jwt'

const PUBLIC_PATHS = ['/login', '/forgot-password', '/reset-password']

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  )
}

/**
 * Endpoints that authenticate themselves rather than by session cookie.
 *
 * The scheduled-job routes take an `Authorization: Bearer <CRON_SECRET>` header
 * — a scheduler has no cookie jar — and check it in the handler. Without this
 * exemption they would be redirected to /login with a 302, which a cron would
 * happily record as a successful call while the sweep never ran.
 *
 * This grants nothing on its own: every route under here refuses an unsigned
 * request itself, and answers 401 rather than redirecting.
 */
const SELF_AUTHENTICATING_PREFIX = '/api/jobs/'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname.startsWith(SELF_AUTHENTICATING_PREFIX)) {
    return NextResponse.next()
  }

  const session = await verifySession(
    request.cookies.get(SESSION_COOKIE)?.value,
  )
  const publicPath = isPublicPath(pathname)

  if (!session && !publicPath) {
    // Keep the query string too — bouncing someone off a filtered lead list
    // and returning them to an unfiltered one loses their place.
    const returnTo = `${pathname}${request.nextUrl.search}`
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    if (returnTo !== '/') url.searchParams.set('next', returnTo)
    return NextResponse.redirect(url)
  }

  if (session && publicPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
