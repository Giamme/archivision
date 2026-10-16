'use client';

import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { useState, type FormEvent } from 'react';
import { completeCheckout } from '@/app/actions/checkout';
import { formatMoney } from '@/lib/format';

// loaded once per page view; the publishable key is the only Stripe key the browser ever sees
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '');

interface PaymentSheetProps {
  checkoutId: string;
  clientSecret: string;
  totalCents: number;
  currency: string;
}

export function PaymentSheet(props: PaymentSheetProps) {
  return (
    <Elements stripe={stripePromise} options={{ clientSecret: props.clientSecret, appearance: { theme: 'flat' } }}>
      <PayButton {...props} />
    </Elements>
  );
}

function PayButton({ checkoutId, totalCents, currency }: PaymentSheetProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [{ paying, error }, setStatus] = useState<{ paying: boolean; error: string | null }>({ paying: false, error: null });

  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripe || !elements) return;
    setStatus({ paying: true, error: null });
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/checkout/success?checkout=${checkoutId}` },
      redirect: 'if_required', // cards finish here; bank redirects come back through return_url
    });
    if (result.error) {
      setStatus({ paying: false, error: result.error.message ?? 'Your payment did not go through.' });
      return;
    }
    await completeCheckout(checkoutId);
  }

  return (
    <form onSubmit={pay} className="payment-sheet">
      <h2>Payment</h2>
      <PaymentElement />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="button" disabled={!stripe || paying}>
        {paying ? 'Paying…' : `Pay ${formatMoney(totalCents, currency)}`}
      </button>
    </form>
  );
}
