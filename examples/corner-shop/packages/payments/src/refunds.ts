import { prisma, type Refund } from '@corner/db';
import { stripeClient } from './stripe';

export class RefundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefundError';
  }
}

export interface RefundInput {
  orderId: string;
  amountCents: number;
  reason: string;
  staffId: string;
}

/**
 * Refunds part or all of an order's payment through Stripe, then writes the refund to the payments' own refunds
 * table. The Order service is not told (yet): see "Refunds" in the README.
 */
export async function refundOrder(input: RefundInput): Promise<Refund> {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    include: { checkout: { include: { payments: { where: { status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] } } } } } },
  });
  if (!order) throw new RefundError('Order not found');
  const payment = order.checkout.payments[0];
  if (!payment) throw new RefundError('This order has no captured payment to refund');
  const left = payment.amountCents - payment.refundedCents;
  if (!Number.isInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > left) {
    throw new RefundError(`Refund between 1 and ${left} cents`);
  }
  if (!input.reason.trim()) throw new RefundError('Say why: the customer sees the reason on their receipt');

  const stripeRefund = await stripeClient().refunds.create(
    { payment_intent: payment.stripeIntentId, amount: input.amountCents, metadata: { orderId: order.id, staffId: input.staffId } },
    { idempotencyKey: `refund:${payment.id}:${payment.refundedCents}:${input.amountCents}` },
  );

  const refundedCents = payment.refundedCents + input.amountCents;
  const [refund] = await prisma.$transaction([
    prisma.refund.create({
      data: {
        paymentId: payment.id,
        orderId: order.id,
        stripeRefundId: stripeRefund.id,
        amountCents: input.amountCents,
        reason: input.reason.trim(),
        staffId: input.staffId,
      },
    }),
    prisma.payment.update({
      where: { id: payment.id },
      data: { refundedCents, status: refundedCents === payment.amountCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
    }),
    prisma.auditLog.create({
      data: { action: 'refund.created', entity: 'order', entityId: order.id, staffId: input.staffId, data: { amountCents: input.amountCents, stripeRefundId: stripeRefund.id } },
    }),
  ]);
  return refund;
}

export async function listRefunds(take = 50) {
  return prisma.refund.findMany({
    orderBy: { createdAt: 'desc' },
    take,
    include: { order: { select: { id: true, number: true, currency: true } }, staff: { select: { name: true } } },
  });
}
