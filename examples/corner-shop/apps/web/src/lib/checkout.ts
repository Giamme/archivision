import { createPaymentIntent } from '@corner/payments';
import { receiveOrder, type ReceiveOrderInput } from '@corner/orders';

export interface BegunCheckout {
  checkoutId: string;
  clientSecret: string;
  totalCents: number;
  currency: string;
  holdExpiresAt: Date;
}

/**
 * The two calls behind every checkout, from the checkout page and from POST /api/orders alike: the Order service
 * receives the cart (prices it, holds the stock, opens a checkout), then the Payment service makes the
 * PaymentIntent the payment sheet confirms.
 */
export async function beginCheckout(input: ReceiveOrderInput): Promise<BegunCheckout> {
  const received = await receiveOrder(input);
  const intent = await createPaymentIntent({
    checkoutId: received.checkoutId,
    amountCents: received.totalCents,
    currency: received.currency,
    email: input.email,
  });
  return { ...received, clientSecret: intent.clientSecret };
}
