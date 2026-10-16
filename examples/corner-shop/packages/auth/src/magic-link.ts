import { randomBytes } from 'node:crypto';
import { prisma } from '@corner/db';
import { createSession, hashToken } from './session';

const LINK_MINUTES = 15;
const POSTMARK_URL = 'https://api.postmarkapp.com/email/withTemplate';
const FROM = 'Corner Shop <hello@example.com>';

/** Emails a one-time sign-in link. It says nothing about whether the address already has an account. */
export async function sendMagicLink(email: string, baseUrl: string): Promise<void> {
  const address = email.trim().toLowerCase();
  const token = randomBytes(32).toString('base64url');
  await prisma.verificationToken.create({
    data: { email: address, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + LINK_MINUTES * 60_000) },
  });
  const link = new URL('/sign-in/verify', baseUrl);
  link.searchParams.set('token', token);
  await sendSignInEmail(address, link.toString());
}

/**
 * Uses a sign-in link. A token works once: it is deleted before anything else, so a link opened twice (mail
 * scanners do that) cannot start two sessions. The account is made on the first sign-in.
 */
export async function redeemMagicLink(token: string): Promise<{ token: string; expiresAt: Date } | null> {
  const row = await prisma.verificationToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row) return null;
  await prisma.verificationToken.delete({ where: { id: row.id } });
  if (row.expiresAt <= new Date()) return null;
  const user = await prisma.user.upsert({ where: { email: row.email }, update: {}, create: { email: row.email } });
  return createSession({ userId: user.id });
}

// Order and shipping emails come from the notifier service; this one is sent from here so sign-in never waits on the bus.
async function sendSignInEmail(to: string, link: string): Promise<void> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) {
    if (process.env.NODE_ENV === 'production') throw new Error('POSTMARK_SERVER_TOKEN is not set');
    console.info(`[auth] sign-in link for ${to}: ${link}`); // local development: no email provider
    return;
  }
  const res = await fetch(POSTMARK_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': token },
    body: JSON.stringify({ From: FROM, To: to, TemplateAlias: 'sign-in-link', TemplateModel: { link, minutes: LINK_MINUTES }, MessageStream: 'outbound' }),
  });
  if (!res.ok) throw new Error(`Postmark answered ${res.status}: ${await res.text()}`);
}
