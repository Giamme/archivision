'use client';

import { useActionState } from 'react';
import type { Address } from '@corner/db';
import type { PricedCart } from '@corner/orders';
import { startCheckout } from '@/app/actions/checkout';
import { formatMoney } from '@/lib/format';
import { AddressForm } from './AddressForm';
import { PaymentSheet } from './PaymentSheet';

interface CheckoutFormProps {
  cart: PricedCart;
  email: string | null;
  addresses: Address[];
}

/** Two steps on one page: the address (which holds the stock and opens the checkout), then the payment sheet. */
export function CheckoutForm({ cart, email, addresses }: CheckoutFormProps) {
  const [state, formAction, pending] = useActionState(startCheckout, null);
  const saved = addresses.find(a => a.isDefault) ?? addresses[0] ?? null;

  if (state?.ok) {
    return <PaymentSheet checkoutId={state.checkoutId} clientSecret={state.clientSecret} totalCents={state.totalCents} currency={state.currency} />;
  }

  return (
    <form action={formAction} className="checkout-form">
      <h2>Where should it go?</h2>
      {email ? (
        <p className="muted">Signed in as {email}</p>
      ) : (
        <label>
          Email, for the receipt <input name="email" type="email" required autoComplete="email" />
        </label>
      )}
      {saved && <input type="hidden" name="addressId" value={saved.id} />}
      <AddressForm address={saved} />
      {state?.ok === false && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      <button className="button" disabled={pending}>
        {pending ? 'Holding your items…' : `Continue to payment · ${formatMoney(cart.totalCents, cart.currency)}`}
      </button>
    </form>
  );
}
