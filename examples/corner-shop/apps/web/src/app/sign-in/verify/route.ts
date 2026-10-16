import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, redeemMagicLink } from '@corner/auth';

/** GET /sign-in/verify?token=…: the link from the sign-in email. Starts a session and goes back where the customer was. */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const next = request.nextUrl.searchParams.get('next');
  const session = token ? await redeemMagicLink(token) : null;
  if (!session) return NextResponse.redirect(new URL('/sign-in?expired=1', request.url));

  const response = NextResponse.redirect(new URL(next?.startsWith('/') ? next : '/account', request.url));
  response.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: session.expiresAt,
    path: '/',
  });
  return response;
}
