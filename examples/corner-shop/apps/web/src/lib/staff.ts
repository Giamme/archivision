import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NotAuthorizedError, SESSION_COOKIE, requireStaff, type StaffSession } from '@corner/auth';
import type { StaffRole } from '@corner/db';

export const STAFF_STATE_COOKIE = 'cs_staff_state';

async function staffToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
}

/** For back office pages and actions: the staff session, or a redirect to Google Workspace sign-in. */
export async function staffOrRedirect(roles?: StaffRole[]): Promise<StaffSession> {
  try {
    return await requireStaff(await staffToken(), roles);
  } catch (err) {
    if (err instanceof NotAuthorizedError) redirect(roles ? '/admin?denied=1' : '/api/staff/sign-in');
    throw err;
  }
}

/** For back office API routes: the staff session or null, so the route can answer 401 instead of redirecting. */
export async function staffForApi(roles?: StaffRole[]): Promise<StaffSession | null> {
  try {
    return await requireStaff(await staffToken(), roles);
  } catch (err) {
    if (err instanceof NotAuthorizedError) return null;
    throw err;
  }
}
