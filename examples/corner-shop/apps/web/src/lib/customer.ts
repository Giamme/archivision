import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, getSession, type CustomerSession } from '@corner/auth';

export async function sessionToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
}

/** The signed-in customer, or null for guests (and for staff browsing the shop). */
export async function currentCustomer(): Promise<CustomerSession | null> {
  const session = await getSession(await sessionToken());
  return session?.kind === 'customer' ? session : null;
}

/** For account pages and actions: the customer, or off to sign-in and back here afterwards. */
export async function customerOrRedirect(returnTo: string): Promise<CustomerSession> {
  const customer = await currentCustomer();
  if (!customer) redirect(`/sign-in?next=${encodeURIComponent(returnTo)}`);
  return customer;
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', expires: expiresAt, path: '/' });
}
