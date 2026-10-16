import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  orderFindUnique: vi.fn(),
  refundCreate: vi.fn(),
  paymentUpdate: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
  stripeRefund: vi.fn(),
}));
vi.mock('@corner/db', () => ({
  prisma: {
    order: { findUnique: m.orderFindUnique },
    refund: { create: m.refundCreate },
    payment: { update: m.paymentUpdate },
    auditLog: { create: m.auditCreate },
    $transaction: m.transaction,
  },
}));
vi.mock('../src/stripe', () => ({ stripeClient: () => ({ refunds: { create: m.stripeRefund } }) }));

import { RefundError, refundOrder } from '../src/refunds';

const paidOrder = (refundedCents = 0) => ({
  id: 'ord_1',
  checkout: { payments: [{ id: 'pay_1', stripeIntentId: 'pi_1', amountCents: 5000, refundedCents }] },
});

beforeEach(() => vi.clearAllMocks());

describe('refundOrder', () => {
  it('refunds through Stripe and records the refund', async () => {
    m.orderFindUnique.mockResolvedValueOnce(paidOrder());
    m.stripeRefund.mockResolvedValueOnce({ id: 're_1' });
    m.refundCreate.mockResolvedValueOnce({ id: 'ref_1', amountCents: 1500 });
    const refund = await refundOrder({ orderId: 'ord_1', amountCents: 1500, reason: 'Arrived chipped', staffId: 'staff_1' });
    expect(refund).toEqual({ id: 'ref_1', amountCents: 1500 });
    expect(m.paymentUpdate).toHaveBeenCalledWith({ where: { id: 'pay_1' }, data: { refundedCents: 1500, status: 'PARTIALLY_REFUNDED' } });
  });

  it('marks the payment refunded when nothing is left', async () => {
    m.orderFindUnique.mockResolvedValueOnce(paidOrder(3000));
    m.stripeRefund.mockResolvedValueOnce({ id: 're_2' });
    await refundOrder({ orderId: 'ord_1', amountCents: 2000, reason: 'Never arrived', staffId: 'staff_1' });
    expect(m.paymentUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { refundedCents: 5000, status: 'REFUNDED' } }));
  });

  it('will not refund more than was paid', async () => {
    m.orderFindUnique.mockResolvedValueOnce(paidOrder(4000));
    await expect(refundOrder({ orderId: 'ord_1', amountCents: 1500, reason: 'Too much', staffId: 'staff_1' })).rejects.toBeInstanceOf(RefundError);
    expect(m.stripeRefund).not.toHaveBeenCalled();
  });
});
