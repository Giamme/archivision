import { prisma } from '@/lib/db';
import { total } from '@/lib/pricing';

/** Creates an order and its audit entry in one transaction. */
export async function checkout(customerId: string, lines: { productId: string; price: number; qty: number }[]) {
  const amount = total(lines);
  return prisma.$transaction(async (tx: any) => {
    const order = await tx.order.create({ data: { customerId, status: 'new', lines: { create: lines } } });
    await tx.auditLog.create({ data: { action: `checkout ${amount}`, orderId: order.id } });
    return order;
  });
}

export async function cancelOrder(id: string) {
  return prisma.order
    .update({ where: { id }, data: { status: 'cancelled' } });
}

export async function listOrders(customerId: string) {
  return prisma.order.findMany({ where: { customerId } });
}
