import { prisma } from '@corner/db';
import { stripeClient } from './stripe';

export interface IntentInput {
  checkoutId: string;
  amountCents: number;
  currency: string;
  email: string;
}

export interface CreatedIntent {
  paymentId: string;
  clientSecret: string;
}

/**
 * The PaymentIntent the checkout's payment sheet confirms. A second call for the same checkout (a reload, a retry)
 * reuses the open intent instead of charging twice; Stripe's idempotency key covers a retry of the create itself.
 */
export async function createPaymentIntent(input: IntentInput): Promise<CreatedIntent> {
  const open = await prisma.payment.findFirst({ where: { checkoutId: input.checkoutId, status: 'REQUIRES_PAYMENT' } });
  if (open) {
    const intent = await stripeClient().paymentIntents.retrieve(open.stripeIntentId);
    if (intent.client_secret && intent.status !== 'canceled') return { paymentId: open.id, clientSecret: intent.client_secret };
  }
  const intent = await stripeClient().paymentIntents.create(
    {
      amount: input.amountCents,
      currency: input.currency.toLowerCase(),
      receipt_email: input.email,
      automatic_payment_methods: { enabled: true },
      metadata: { checkoutId: input.checkoutId },
    },
    { idempotencyKey: `checkout:${input.checkoutId}:${input.amountCents}` },
  );
  if (!intent.client_secret) throw new Error(`PaymentIntent ${intent.id} came back without a client secret`);
  const payment = await prisma.payment.create({
    data: {
      checkoutId: input.checkoutId,
      stripeIntentId: intent.id,
      amountCents: input.amountCents,
      currency: input.currency.toUpperCase(),
    },
  });
  return { paymentId: payment.id, clientSecret: intent.client_secret };
}
