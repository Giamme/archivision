import { NextResponse, type NextRequest } from 'next/server';

// The same name as SESSION_COOKIE in @corner/auth. Middleware runs on the edge, where Prisma cannot, so it only
// checks that a session cookie is there; the admin layout and the account pages check the session itself.
const SESSION_COOKIE = 'cs_session';

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  if (pathname.startsWith('/admin')) {
    return NextResponse.redirect(new URL('/api/staff/sign-in', request.url));
  }
  if (pathname.startsWith('/account')) {
    const signIn = new URL('/sign-in', request.url);
    signIn.searchParams.set('next', pathname + search);
    return NextResponse.redirect(signIn);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/account/:path*'],
};
