import { NextResponse, type NextRequest } from 'next/server'

import { SESSION_COOKIE, verifySession } from '@/lib/auth/jwt'

const PUBLIC_PATHS = ['/login', '/forgot-password', '/reset-password']

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  )
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const session = await verifySession(
    request.cookies.get(SESSION_COOKIE)?.value,
  )
  const publicPath = isPublicPath(pathname)

  if (!session && !publicPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    // Preserve where they were heading so login can send them back.
    if (pathname !== '/') url.searchParams.set('next', pathname)
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
