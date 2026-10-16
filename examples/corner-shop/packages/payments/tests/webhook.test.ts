import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  publish: vi.fn(),
  constructEvent: vi.fn(),
}));
vi.mock('@corner/db', () => ({ prisma: { payment: { updateMany: m.updateMany, findUniqueOrThrow: m.findUniqueOrThrow } } }));
vi.mock('@corner/events', () => ({ publish: m.publish, SUBJECTS: { paymentSucceeded: 'payment.succeeded', paymentFailed: 'payment.failed' } }));
vi.mock('../src/stripe', () => ({ stripeClient: () => ({ webhooks: { constructEvent: m.constructEvent } }), webhookSecret: () => 'test-webhook-secret' }));

import { WebhookSignatureError, handleStripeEvent, verifyStripeEvent } from '../src/webhook';

const intentEvent = (type: string, object: Record<string, unknown>) => ({ type, data: { object } }) as never;

beforeEach(() => vi.clearAllMocks());

describe('verifyStripeEvent', () => {
  it('refuses a request without a signature', () => {
    expect(() => verifyStripeEvent('{}', null)).toThrow(WebhookSignatureError);
  });

  it('turns a bad signature into a WebhookSignatureError', () => {
    m.constructEvent.mockImplementationOnce(() => {
      throw new Error('No signatures found matching the expected signature');
    });
    expect(() => verifyStripeEvent('{}', 't=1,v1=abc')).toThrow(WebhookSignatureError);
  });
});

describe('handleStripeEvent', () => {
  it('marks the payment succeeded and publishes payment.succeeded once', async () => {
    m.updateMany.mockResolvedValueOnce({ count: 1 });
    m.findUniqueOrThrow.mockResolvedValueOnce({ id: 'pay_1', checkoutId: 'chk_1' });
    const result = await handleStripeEvent(intentEvent('payment_intent.succeeded', { id: 'pi_1', amount_received: 3295, currency: 'eur' }));
    expect(result).toBe('handled');
    expect(m.publish).toHaveBeenCalledWith('payment.succeeded', {
      paymentId: 'pay_1',
      checkoutId: 'chk_1',
      stripeIntentId: 'pi_1',
      amountCents: 3295,
      currency: 'eur',
    });
  });

  it('does not publish again for a webhook Stripe retried', async () => {
    m.updateMany.mockResolvedValueOnce({ count: 0 });
    await handleStripeEvent(intentEvent('payment_intent.succeeded', { id: 'pi_1', amount_received: 3295, currency: 'eur' }));
    expect(m.publish).not.toHaveBeenCalled();
  });

  it('publishes payment.failed with the failure code', async () => {
    m.updateMany.mockResolvedValueOnce({ count: 1 });
    m.findUniqueOrThrow.mockResolvedValueOnce({ id: 'pay_2', checkoutId: 'chk_2' });
    await handleStripeEvent(intentEvent('payment_intent.payment_failed', { id: 'pi_2', last_payment_error: { code: 'card_declined' } }));
    expect(m.publish).toHaveBeenCalledWith('payment.failed', expect.objectContaining({ checkoutId: 'chk_2', failureCode: 'card_declined' }));
  });

  it('ignores event types it does not use', async () => {
    expect(await handleStripeEvent(intentEvent('charge.dispute.created', {}))).toBe('ignored');
  });
});
