'use server';

import { cookies, headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, endSession, sendMagicLink } from '@corner/auth';
import { deleteAddress, saveAddress } from '@corner/orders';
import { customerOrRedirect } from '@/lib/customer';
import { checkbox, optional, text } from '@/lib/format';

export type SignInState = { ok: false; error: string } | null;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Sends the sign-in link and moves on to "check your email", whether or not the address has an account. */
export async function requestSignInLink(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = text(formData, 'email');
  if (!EMAIL.test(email)) return { ok: false, error: 'Enter the email address you shop with.' };
  const h = await headers();
  const origin = h.get('origin') ?? `https://${h.get('host') ?? 'localhost:3000'}`;
  await sendMagicLink(email, origin);
  redirect(`/sign-in/check-email?email=${encodeURIComponent(email)}`);
}

/** Adds an address to the address book (or edits one, when the form carries its id). */
export async function saveAddressAction(formData: FormData): Promise<void> {
  const customer = await customerOrRedirect('/account/addresses');
  const filled = ['name', 'line1', 'city', 'postalCode'].every(name => text(formData, name));
  if (!filled || text(formData, 'country').length !== 2) redirect('/account/addresses?error=missing');
  await saveAddress(customer.userId, {
    id: optional(formData, 'id') ?? undefined,
    label: optional(formData, 'label'),
    name: text(formData, 'name'),
    line1: text(formData, 'line1'),
    line2: optional(formData, 'line2'),
    city: text(formData, 'city'),
    postalCode: text(formData, 'postalCode'),
    country: text(formData, 'country'),
    phone: optional(formData, 'phone'),
    isDefault: checkbox(formData, 'isDefault'),
  });
  revalidatePath('/account/addresses');
}

export async function deleteAddressAction(formData: FormData): Promise<void> {
  const customer = await customerOrRedirect('/account/addresses');
  await deleteAddress(customer.userId, text(formData, 'id'));
  revalidatePath('/account/addresses');
}

export async function signOut(): Promise<never> {
  const jar = await cookies();
  await endSession(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect('/');
}
