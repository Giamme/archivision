import { cookies } from 'next/headers';
import type { CartLine } from '@corner/orders';

export const CART_COOKIE = 'cs_cart';
export const DISCOUNT_COOKIE = 'cs_discount';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14;
const MAX_LINES = 30;
const MAX_QUANTITY = 20;
const SKU = /^[A-Z0-9-]{2,32}$/;

/**
 * The cart lives in a cookie, not the database: "MUG-SAND:2,TOTE-INK:1". Prices are never stored in it; the cart
 * page and the checkout price it again, so a stale cookie cannot change what someone pays.
 */
export function parseCart(value: string | undefined): CartLine[] {
  if (!value) return [];
  const lines: CartLine[] = [];
  for (const part of value.split(',').slice(0, MAX_LINES)) {
    const [sku = '', qty = ''] = part.split(':');
    const quantity = Number.parseInt(qty, 10);
    if (SKU.test(sku) && quantity > 0) lines.push({ sku, quantity: Math.min(quantity, MAX_QUANTITY) });
  }
  return lines;
}

export function serializeCart(lines: CartLine[]): string {
  return lines.map(l => `${l.sku}:${l.quantity}`).join(',');
}

/** The cart with one line set to a quantity; 0 removes the line. */
export function setQuantity(lines: CartLine[], sku: string, quantity: number): CartLine[] {
  const rest = lines.filter(l => l.sku !== sku);
  if (quantity <= 0) return rest;
  const at = lines.findIndex(l => l.sku === sku);
  const line = { sku, quantity: Math.min(quantity, MAX_QUANTITY) };
  return at === -1 ? [...rest, line] : [...rest.slice(0, at), line, ...rest.slice(at)];
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((n, l) => n + l.quantity, 0);
}

export async function readCart(): Promise<CartLine[]> {
  const jar = await cookies();
  return parseCart(jar.get(CART_COOKIE)?.value);
}

/** The number of items, for the header's cart badge. */
export async function readCartCount(): Promise<number> {
  return cartCount(await readCart());
}

/** Only server actions and route handlers may call this: pages cannot set cookies. */
export async function writeCart(lines: CartLine[]): Promise<void> {
  const jar = await cookies();
  if (!lines.length) {
    jar.delete(CART_COOKIE);
    jar.delete(DISCOUNT_COOKIE);
    return;
  }
  jar.set(CART_COOKIE, serializeCart(lines), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_SECONDS,
    path: '/',
  });
}

export async function readDiscountCode(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(DISCOUNT_COOKIE)?.value ?? null;
}
