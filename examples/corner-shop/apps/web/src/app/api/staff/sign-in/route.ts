import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { NotAuthorizedError, SESSION_COOKIE, completeStaffSignIn, staffSignInUrl } from '@corner/auth';
import { STAFF_STATE_COOKIE } from '@/lib/staff';

const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' } as const;

/**
 * GET /api/staff/sign-in, both legs of Google Workspace sign-in: without a code it sends staff to Google with a state
 * value; Google sends them back here with a code, which becomes a staff session.
 */
export async function GET(request: NextRequest) {
  const here = new URL('/api/staff/sign-in', request.url).toString();
  const code = request.nextUrl.searchParams.get('code');
  if (!code) {
    const state = randomBytes(16).toString('hex');
    const response = NextResponse.redirect(staffSignInUrl(state, here));
    response.cookies.set(STAFF_STATE_COOKIE, state, { ...cookieOptions, maxAge: 600, path: '/api/staff' });
    return response;
  }
  if (request.nextUrl.searchParams.get('state') !== request.cookies.get(STAFF_STATE_COOKIE)?.value) {
    return NextResponse.json({ error: 'The sign-in expired. Start again.' }, { status: 400 });
  }
  try {
    const session = await completeStaffSignIn(code, here);
    const response = NextResponse.redirect(new URL('/admin', request.url));
    response.cookies.set(SESSION_COOKIE, session.token, { ...cookieOptions, expires: session.expiresAt, path: '/' });
    response.cookies.delete(STAFF_STATE_COOKIE);
    return response;
  } catch (err) {
    if (err instanceof NotAuthorizedError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
}
