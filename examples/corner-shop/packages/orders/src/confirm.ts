import { prisma, type Checkout } from '@corner/db';
import { publish, SUBJECTS, type PaymentFailed, type PaymentSucceeded, type ShippingAddress } from '@corner/events';
import { keepOrder } from './keep';
import { releaseOrder } from './reserve';
import type { PricedLine } from './price';

/**
 * Confirm step, on payment.succeeded: checks the amount against the checkout, keeps the order and publishes
 * order.confirmed. Safe to run twice: a redelivered event finds the checkout already kept and does nothing.
 */
export async function confirmCheckout(event: PaymentSucceeded): Promise<{ orderId: string } | null> {
  const checkout = await prisma.checkout.findUnique({ where: { id: event.checkoutId }, include: { order: { select: { id: true } } } });
  if (!checkout) {
    console.warn(`[orders] payment ${event.paymentId} names unknown checkout ${event.checkoutId}`);
    return null;
  }
  if (checkout.status === 'KEPT' && checkout.order) return { orderId: checkout.order.id };
  if (checkout.totalCents !== event.amountCents || checkout.currency !== event.currency.toUpperCase()) {
    // never ship an order that was paid for a different amount; support refunds it by hand
    throw new Error(`Checkout ${checkout.id} totals ${checkout.totalCents} ${checkout.currency}, payment was ${event.amountCents} ${event.currency}`);
  }
  const order = await keepOrder(checkout);
  await announceOrder(checkout, order.id, order.number, order.placedAt);
  return { orderId: order.id };
}

async function announceOrder(checkout: Checkout, orderId: string, orderNumber: string, placedAt: Date): Promise<void> {
  const lines = checkout.linesJson as unknown as PricedLine[];
  await publish(SUBJECTS.orderConfirmed, {
    orderId,
    orderNumber,
    email: checkout.email,
    totalCents: checkout.totalCents,
    currency: checkout.currency,
    shipping: checkout.shippingJson as unknown as ShippingAddress,
    lines: lines.map(l => ({ sku: l.sku, name: l.name, quantity: l.quantity, weightGrams: l.weightGrams, totalCents: l.totalCents })),
    placedAt: placedAt.toISOString(),
  });
}

/** On payment.failed: the checkout gives its stock back. The customer can try again from the cart. */
export async function releaseCheckout(event: PaymentFailed): Promise<void> {
  const checkout = await prisma.checkout.findUnique({ where: { id: event.checkoutId } });
  if (!checkout || checkout.status !== 'OPEN') return;
  await releaseOrder(checkout.linesJson as unknown as PricedLine[]);
  await prisma.checkout.update({ where: { id: checkout.id }, data: { status: 'RELEASED' } });
}

/** Runs every minute from the worker: open checkouts whose hold ran out give their stock back. */
export async function expireCheckouts(now = new Date()): Promise<number> {
  const stale = await prisma.checkout.findMany({ where: { status: 'OPEN', holdExpiresAt: { lt: now } }, take: 100 });
  for (const checkout of stale) {
    const claimed = await prisma.checkout.updateMany({ where: { id: checkout.id, status: 'OPEN' }, data: { status: 'RELEASED' } });
    if (claimed.count) await releaseOrder(checkout.linesJson as unknown as PricedLine[]);
  }
  return stale.length;
}
