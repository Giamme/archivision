import { createHash, randomBytes } from 'node:crypto';
import { prisma, type StaffRole } from '@corner/db';

export const SESSION_COOKIE = 'cs_session';
const CUSTOMER_DAYS = 30;
const STAFF_HOURS = 12;

export interface CustomerSession {
  kind: 'customer';
  sessionId: string;
  userId: string;
  email: string;
  name: string | null;
}

export interface StaffSession {
  kind: 'staff';
  sessionId: string;
  staffId: string;
  email: string;
  name: string;
  role: StaffRole;
}

export type AnySession = CustomerSession | StaffSession;

export class NotAuthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotAuthorizedError';
  }
}

/** Sessions and sign-in links are stored as sha-256 hashes, so a database dump holds no working cookie. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The session behind a cookie value. Unknown, expired and deactivated sessions all count as none. */
export async function getSession(token: string | null | undefined): Promise<AnySession | null> {
  if (!token) return null;
  const row = await prisma.session.findUnique({ where: { token: hashToken(token) }, include: { user: true, staff: true } });
  if (!row || row.expiresAt <= new Date()) return null;
  if (row.staff) {
    if (!row.staff.active) return null;
    return { kind: 'staff', sessionId: row.id, staffId: row.staff.id, email: row.staff.email, name: row.staff.name, role: row.staff.role };
  }
  if (row.user) return { kind: 'customer', sessionId: row.id, userId: row.user.id, email: row.user.email, name: row.user.name };
  return null;
}

/** For the back office: the staff session, optionally with one of some roles; throws NotAuthorizedError otherwise. */
export async function requireStaff(token: string | null | undefined, roles?: StaffRole[]): Promise<StaffSession> {
  const session = await getSession(token);
  if (!session || session.kind !== 'staff') throw new NotAuthorizedError('Staff sign-in required');
  if (roles && session.role !== 'ADMIN' && !roles.includes(session.role)) {
    throw new NotAuthorizedError(`This needs one of these roles: ${roles.join(', ')}`);
  }
  return session;
}

export async function requireCustomer(token: string | null | undefined): Promise<CustomerSession> {
  const session = await getSession(token);
  if (!session || session.kind !== 'customer') throw new NotAuthorizedError('Sign in to see your account');
  return session;
}

/** Starts a session and returns the cookie value; customers stay signed in for a month, staff for a working day. */
export async function createSession(owner: { userId: string } | { staffId: string }): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const hours = 'staffId' in owner ? STAFF_HOURS : CUSTOMER_DAYS * 24;
  const expiresAt = new Date(Date.now() + hours * 3_600_000);
  await prisma.session.create({ data: { token: hashToken(token), expiresAt, ...owner } });
  return { token, expiresAt };
}

export async function endSession(token: string | null | undefined): Promise<void> {
  if (!token) return;
  await prisma.session.deleteMany({ where: { token: hashToken(token) } });
}
