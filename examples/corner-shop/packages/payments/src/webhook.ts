import type Stripe from 'stripe';
import { prisma } from '@corner/db';
import { publish, SUBJECTS } from '@corner/events';
import { stripeClient, webhookSecret } from './stripe';

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

/** Checks the Stripe-Signature header against the raw body. Anything else is not from Stripe. */
export function verifyStripeEvent(rawBody: string, signature: string | null): Stripe.Event {
  if (!signature) throw new WebhookSignatureError('Missing Stripe-Signature header');
  try {
    return stripeClient().webhooks.constructEvent(rawBody, signature, webhookSecret());
  } catch (err) {
    throw new WebhookSignatureError(err instanceof Error ? err.message : 'Bad signature');
  }
}

/** Handles a verified event. Types we do not use are acknowledged, so Stripe stops sending them again. */
export async function handleStripeEvent(event: Stripe.Event): Promise<'handled' | 'ignored'> {
  switch (event.type) {
    case 'payment_intent.succeeded':
      await markSucceeded(event.data.object);
      return 'handled';
    case 'payment_intent.payment_failed':
      await markFailed(event.data.object);
      return 'handled';
    default:
      return 'ignored';
  }
}

/** POST /stripe/webhook: verify, then handle. */
export async function handleStripeWebhook(rawBody: string, signature: string | null): Promise<'handled' | 'ignored'> {
  const event = verifyStripeEvent(rawBody, signature);
  return handleStripeEvent(event);
}

// Stripe retries webhooks and may send them out of order: only a payment still waiting moves on, and only that move
// publishes, so payment.succeeded goes out once per payment.
async function markSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
  const moved = await prisma.payment.updateMany({
    where: { stripeIntentId: intent.id, status: { in: ['REQUIRES_PAYMENT', 'FAILED'] } },
    data: { status: 'SUCCEEDED', failureCode: null },
  });
  if (moved.count === 0) return;
  const payment = await prisma.payment.findUniqueOrThrow({ where: { stripeIntentId: intent.id } });
  await publish(SUBJECTS.paymentSucceeded, {
    paymentId: payment.id,
    checkoutId: payment.checkoutId,
    stripeIntentId: intent.id,
    amountCents: intent.amount_received,
    currency: intent.currency,
  });
}

async function markFailed(intent: Stripe.PaymentIntent): Promise<void> {
  const failureCode = intent.last_payment_error?.code ?? null;
  const moved = await prisma.payment.updateMany({
    where: { stripeIntentId: intent.id, status: 'REQUIRES_PAYMENT' },
    data: { status: 'FAILED', failureCode },
  });
  if (moved.count === 0) return;
  const payment = await prisma.payment.findUniqueOrThrow({ where: { stripeIntentId: intent.id } });
  await publish(SUBJECTS.paymentFailed, { paymentId: payment.id, checkoutId: payment.checkoutId, stripeIntentId: intent.id, failureCode });
}
