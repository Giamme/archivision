import { prisma, type Checkout } from '@corner/db';
import { commitStock } from '@corner/catalog';
import type { PricedLine } from './price';

export interface KeptOrder {
  id: string;
  number: string;
  placedAt: Date;
}

/** CS-2026-000123: the year, then a number from a Postgres sequence, so numbers never repeat or collide. */
async function nextOrderNumber(now = new Date()): Promise<string> {
  const [row] = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT nextval('order_number_seq') AS n`;
  return `CS-${now.getUTCFullYear()}-${String(row?.n ?? 0).padStart(6, '0')}`;
}

/**
 * Keep step: writes the order and its lines from a paid checkout, in one transaction with the checkout's new status,
 * the discount's redemption and the audit entry. Then the held stock leaves the shelf.
 */
export async function keepOrder(checkout: Checkout): Promise<KeptOrder> {
  const lines = checkout.linesJson as unknown as PricedLine[];
  const number = await nextOrderNumber();
  const order = await prisma.$transaction(async tx => {
    const created = await tx.order.create({
      data: {
        number,
        checkoutId: checkout.id,
        userId: checkout.userId,
        email: checkout.email,
        addressId: checkout.addressId,
        shippingJson: checkout.shippingJson ?? {},
        currency: checkout.currency,
        subtotalCents: checkout.subtotalCents,
        discountCents: checkout.discountCents,
        shippingCents: checkout.shippingCents,
        totalCents: checkout.totalCents,
        status: 'CONFIRMED',
      },
    });
    await tx.orderLine.createMany({
      data: lines.map(l => ({
        orderId: created.id,
        variantId: l.variantId,
        sku: l.sku,
        name: l.name,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        discountCents: l.discountCents,
        totalCents: l.totalCents,
      })),
    });
    await tx.checkout.update({ where: { id: checkout.id }, data: { status: 'KEPT' } });
    if (checkout.discountId) {
      await tx.discount.update({ where: { id: checkout.discountId }, data: { redemptions: { increment: 1 } } });
    }
    await tx.auditLog.create({
      data: { action: 'order.kept', entity: 'order', entityId: created.id, data: { number, checkoutId: checkout.id, totalCents: checkout.totalCents } },
    });
    return created;
  });
  await commitStock(lines.map(l => ({ sku: l.sku, quantity: l.quantity })));
  return { id: order.id, number: order.number, placedAt: order.placedAt };
}
