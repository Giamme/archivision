import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, getSession } from '@corner/auth';

/** GET /session: who is signed in, for client code and the other apps. Never cached. */
export async function GET(request: NextRequest) {
  const session = await getSession(request.cookies.get(SESSION_COOKIE)?.value);
  const body = !session
    ? { signedIn: false as const }
    : session.kind === 'staff'
      ? { signedIn: true as const, kind: session.kind, email: session.email, name: session.name, role: session.role }
      : { signedIn: true as const, kind: session.kind, email: session.email, name: session.name };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
