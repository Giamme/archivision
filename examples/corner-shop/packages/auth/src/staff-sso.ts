import { prisma } from '@corner/db';
import { NotAuthorizedError, createSession } from './session';

// Staff sign in with Google Workspace (OAuth 2.0, OpenID Connect).
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

/** Only Workspace accounts of this domain get a back office session. */
export const STAFF_DOMAIN = process.env.STAFF_GOOGLE_DOMAIN ?? 'example.com';

interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  /** The Workspace domain; absent for personal accounts. */
  hd: string | null;
}

function clientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new Error('GOOGLE_CLIENT_ID is not set');
  return id;
}

export function staffSignInUrl(state: string, redirectUri: string): string {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    hd: STAFF_DOMAIN,
    prompt: 'select_account',
  }).toString();
  return url.toString();
}

/** Trades the code from Google's redirect for an id token, and has Google check that token. */
async function exchangeCode(code: string, redirectUri: string): Promise<GoogleIdentity> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`);
  const { id_token: idToken } = (await res.json()) as { id_token?: string };
  if (!idToken) throw new Error('Google sent no id token');
  const info = await fetch(`${TOKENINFO_URL}?id_token=${encodeURIComponent(idToken)}`);
  if (!info.ok) throw new Error('Google could not verify the id token');
  const claims = (await info.json()) as Record<string, string | undefined>;
  if (claims.aud !== clientId()) throw new Error('The id token was issued to another client');
  return {
    sub: claims.sub ?? '',
    email: (claims.email ?? '').toLowerCase(),
    emailVerified: claims.email_verified === 'true',
    name: claims.name ?? claims.email ?? 'Staff',
    hd: claims.hd ?? null,
  };
}

/**
 * Finishes a staff sign-in: the Google account must be of the staff domain, verified, and belong to an active staff
 * member added in the back office beforehand. Signing in never creates staff accounts.
 */
export async function completeStaffSignIn(code: string, redirectUri: string): Promise<{ token: string; expiresAt: Date }> {
  const identity = await exchangeCode(code, redirectUri);
  if (identity.hd !== STAFF_DOMAIN || !identity.emailVerified) {
    throw new NotAuthorizedError(`Sign in with your ${STAFF_DOMAIN} account`);
  }
  const staff = await prisma.staffMember.findUnique({ where: { email: identity.email } });
  if (!staff || !staff.active) throw new NotAuthorizedError('There is no active staff account for this address');
  if (staff.googleSub && staff.googleSub !== identity.sub) throw new NotAuthorizedError('This staff account is linked to another Google account');
  await prisma.staffMember.update({ where: { id: staff.id }, data: { googleSub: identity.sub, name: identity.name, lastLoginAt: new Date() } });
  return createSession({ staffId: staff.id });
}
