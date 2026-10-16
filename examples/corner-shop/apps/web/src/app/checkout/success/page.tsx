import type { Metadata } from 'next';
import Link from 'next/link';
import { getOrderByCheckout } from '@corner/orders';
import { formatMoney } from '@/lib/format';

export const metadata: Metadata = { title: 'Thank you', robots: { index: false } };

/**
 * Stripe sends people here after paying. The order is kept when payment.succeeded reaches the Order service, which
 * usually takes a second or two, so until then the page says so and reloads itself.
 */
export default async function CheckoutSuccessPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout } = await searchParams;
  const order = checkout ? await getOrderByCheckout(checkout) : null;
  if (!order) {
    return (
      <>
        <meta httpEquiv="refresh" content="3" />
        <h1>Confirming your payment…</h1>
        <p className="muted">This page refreshes on its own. You will also get an email.</p>
      </>
    );
  }
  return (
    <>
      <h1>Thank you!</h1>
      <p>
        Order <strong>{order.number}</strong> is confirmed: {formatMoney(order.totalCents, order.currency)}. We sent the receipt to {order.email}.
      </p>
      <Link href="/products">Keep shopping</Link>
    </>
  );
}
