import { prisma, type Prisma } from '@corner/db';
import type { ShippingAddress } from '@corner/events';
import { checkoutColumns, priceCart, type CartLine, type PricedCart } from './price';
import { reserveOrder } from './reserve';

export interface ReceiveOrderInput {
  email: string;
  userId?: string | null;
  addressId?: string | null;
  shipping: ShippingAddress;
  lines: CartLine[];
  discountCode?: string | null;
}

export interface ReceivedOrder {
  checkoutId: string;
  totalCents: number;
  currency: string;
  holdExpiresAt: Date;
}

export class OrderInputError extends Error {
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = 'OrderInputError';
  }
}

const MAX_LINES = 30;
const MAX_QUANTITY = 20;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COUNTRIES = new Set(['AT', 'BE', 'DE', 'DK', 'ES', 'FI', 'FR', 'IE', 'IT', 'LU', 'NL', 'PT', 'SE']);

/** Checks what the customer sent before anything is priced or held. Throws OrderInputError with the field. */
export function validateOrderInput(input: ReceiveOrderInput): void {
  if (!EMAIL.test(input.email)) throw new OrderInputError('Enter a valid email address', 'email');
  if (!input.lines.length) throw new OrderInputError('Your cart is empty', 'lines');
  if (input.lines.length > MAX_LINES) throw new OrderInputError(`At most ${MAX_LINES} different items per order`, 'lines');
  for (const line of input.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QUANTITY) {
      throw new OrderInputError(`Quantity for ${line.sku} must be between 1 and ${MAX_QUANTITY}`, 'lines');
    }
  }
  const s = input.shipping;
  if (!s.name.trim() || !s.line1.trim() || !s.city.trim() || !s.postalCode.trim()) throw new OrderInputError('Fill in the delivery address', 'shipping');
  if (!COUNTRIES.has(s.country)) throw new OrderInputError('We only ship inside the EU for now', 'shipping.country');
}

/**
 * Receive step, the start of an order: checks the input, prices the cart (Price), holds the stock through the
 * catalog (Reserve) and opens a checkout that waits for payment.succeeded (Confirm, in confirm.ts).
 */
export async function receiveOrder(input: ReceiveOrderInput): Promise<ReceivedOrder> {
  validateOrderInput(input);
  const cart = await priceCart(input.lines, input.discountCode);
  const holdExpiresAt = await reserveOrder(cart);
  const checkoutId = await openCheckout(input, cart, holdExpiresAt);
  return { checkoutId, totalCents: cart.totalCents, currency: cart.currency, holdExpiresAt };
}

/** The address as it is stored and published: trimmed, codes in capitals, empty optional fields as null. */
function shippingOf(s: ShippingAddress): ShippingAddress {
  return {
    name: s.name.trim(),
    line1: s.line1.trim(),
    line2: s.line2?.trim() || null,
    city: s.city.trim(),
    postalCode: s.postalCode.trim().toUpperCase(),
    country: s.country.toUpperCase(),
    phone: s.phone?.trim() || null,
  };
}

async function openCheckout(input: ReceiveOrderInput, cart: PricedCart, holdExpiresAt: Date): Promise<string> {
  const checkout = await prisma.checkout.create({
    data: {
      email: input.email.trim().toLowerCase(),
      userId: input.userId ?? null,
      addressId: input.addressId ?? null,
      shippingJson: shippingOf(input.shipping) as unknown as Prisma.InputJsonValue,
      linesJson: cart.lines as unknown as Prisma.InputJsonValue,
      ...checkoutColumns(cart),
      holdExpiresAt,
    },
    select: { id: true },
  });
  return checkout.id;
}
