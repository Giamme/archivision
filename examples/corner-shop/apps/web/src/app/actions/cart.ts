'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getAvailability } from '@corner/catalog';
import { priceCart } from '@corner/orders';
import { DISCOUNT_COOKIE, cartCount, readCart, setQuantity, writeCart } from '@/lib/cart-cookie';

export type AddToCartState = { ok: true; count: number } | { ok: false; error: string } | null;
export type DiscountState = { ok: true; code: string; savedCents: number } | { ok: false; error: string } | null;

/** Adds a variant to the cart, as long as there is enough left of it. */
export async function addToCart(_prev: AddToCartState, formData: FormData): Promise<AddToCartState> {
  const sku = String(formData.get('sku') ?? '');
  const quantity = Number(formData.get('quantity') ?? 1);
  if (!sku) return { ok: false, error: 'Choose a colour or size first.' };
  if (!Number.isInteger(quantity) || quantity < 1) return { ok: false, error: 'Choose how many.' };

  const lines = await readCart();
  const inCart = lines.find(l => l.sku === sku)?.quantity ?? 0;
  const available = await getAvailability(sku);
  if (inCart + quantity > available) {
    return { ok: false, error: available > inCart ? `Only ${available - inCart} more left.` : 'Sold out, sorry.' };
  }
  const next = setQuantity(lines, sku, inCart + quantity);
  await writeCart(next);
  revalidatePath('/', 'layout'); // the header's cart count
  return { ok: true, count: cartCount(next) };
}

export async function updateCartLine(formData: FormData): Promise<void> {
  const sku = String(formData.get('sku') ?? '');
  const quantity = Number(formData.get('quantity') ?? 0);
  const lines = await readCart();
  const available = await getAvailability(sku);
  await writeCart(setQuantity(lines, sku, Math.min(quantity, available)));
  revalidatePath('/cart');
}

export async function removeCartLine(formData: FormData): Promise<void> {
  const lines = await readCart();
  await writeCart(setQuantity(lines, String(formData.get('sku') ?? ''), 0));
  revalidatePath('/cart');
}

/** Checks a code against the cart as it is now, and remembers it for the checkout. A code that saves nothing is refused. */
export async function applyDiscountCode(_prev: DiscountState, formData: FormData): Promise<DiscountState> {
  const code = String(formData.get('code') ?? '').trim().toUpperCase();
  if (!code) return { ok: false, error: 'Enter a code.' };
  const lines = await readCart();
  const [without, withCode] = await Promise.all([priceCart(lines), priceCart(lines, code)]);
  if (withCode.totalCents >= without.totalCents) return { ok: false, error: 'That code does not work on this cart.' };
  const jar = await cookies();
  jar.set(DISCOUNT_COOKIE, code, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 });
  revalidatePath('/cart');
  return { ok: true, code, savedCents: without.totalCents - withCode.totalCents };
}
