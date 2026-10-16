import { releaseStock, reserveStock } from '@corner/catalog';
import type { CartLine, PricedCart } from './price';

/** How long a checkout keeps its stock while the customer pays. */
export const HOLD_MINUTES = 20;

/** Reserve step: holds every line's stock through the catalog; returns when the hold runs out. */
export async function reserveOrder(cart: PricedCart, now = new Date()): Promise<Date> {
  await reserveStock(cart.lines.map(l => ({ sku: l.sku, quantity: l.quantity })));
  return new Date(now.getTime() + HOLD_MINUTES * 60_000);
}

/** Gives a checkout's stock back to the shelf. */
export async function releaseOrder(lines: CartLine[]): Promise<void> {
  await releaseStock(lines.map(l => ({ sku: l.sku, quantity: l.quantity })));
}
