'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { OutOfStockError } from '@corner/catalog';
import type { ShippingAddress } from '@corner/events';
import { OrderInputError, PricingError } from '@corner/orders';
import { readCart, readDiscountCode, writeCart } from '@/lib/cart-cookie';
import { beginCheckout } from '@/lib/checkout';
import { currentCustomer } from '@/lib/customer';
import { optional, text } from '@/lib/format';

export type CheckoutState =
  | { ok: true; checkoutId: string; clientSecret: string; totalCents: number; currency: string }
  | { ok: false; error: string; field?: string }
  | null;

function readShipping(formData: FormData): ShippingAddress {
  return {
    name: text(formData, 'name'),
    line1: text(formData, 'line1'),
    line2: optional(formData, 'line2'),
    city: text(formData, 'city'),
    postalCode: text(formData, 'postalCode'),
    country: text(formData, 'country').toUpperCase(),
    phone: optional(formData, 'phone'),
  };
}

/** Step one of the checkout page: the address is in, so the stock is held and the payment sheet can open. */
export async function startCheckout(_prev: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const lines = await readCart();
  if (!lines.length) return { ok: false, error: 'Your cart is empty.' };
  const customer = await currentCustomer();
  const email = customer?.email ?? text(formData, 'email');
  try {
    const begun = await beginCheckout({
      email,
      userId: customer?.userId ?? null,
      addressId: optional(formData, 'addressId'),
      shipping: readShipping(formData),
      lines,
      discountCode: await readDiscountCode(),
    });
    return { ok: true, checkoutId: begun.checkoutId, clientSecret: begun.clientSecret, totalCents: begun.totalCents, currency: begun.currency };
  } catch (err) {
    if (err instanceof OutOfStockError) return { ok: false, error: `Sorry, only ${err.available} left of ${err.sku}. Update your cart and try again.` };
    if (err instanceof OrderInputError) return { ok: false, error: err.message, field: err.field };
    if (err instanceof PricingError) return { ok: false, error: 'Something in your cart is no longer for sale.' };
    throw err;
  }
}

/** After the payment sheet confirmed: the cart is done with, whatever the bank says next. */
export async function completeCheckout(checkoutId: string): Promise<never> {
  await writeCart([]);
  const origin = (await headers()).get('origin') ?? '';
  console.info(`[checkout] ${checkoutId} paid from ${origin || 'unknown origin'}`);
  redirect(`/checkout/success?checkout=${encodeURIComponent(checkoutId)}`);
}
