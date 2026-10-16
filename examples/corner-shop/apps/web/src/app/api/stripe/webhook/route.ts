import { NextResponse, type NextRequest } from 'next/server';
import { WebhookSignatureError, handleStripeWebhook } from '@corner/payments';

/**
 * POST /stripe/webhook. The signature is checked against the raw body, so it is read as text. A 5xx makes Stripe
 * retry, which the handler is safe against; a bad signature gets a 400 and is not retried.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  try {
    const result = await handleStripeWebhook(raw, request.headers.get('stripe-signature'));
    return NextResponse.json({ received: true, result });
  } catch (err) {
    if (err instanceof WebhookSignatureError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('[stripe] webhook failed', err);
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
  }
}
