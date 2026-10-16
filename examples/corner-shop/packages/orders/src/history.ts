import { prisma, type OrderStatus } from '@corner/db';

const listSelect = {
  id: true,
  number: true,
  status: true,
  totalCents: true,
  currency: true,
  placedAt: true,
  shippedAt: true,
  _count: { select: { lines: true } },
} as const;

/** An account's past orders, newest first. */
export async function listOrdersForUser(userId: string, take = 20) {
  return prisma.order.findMany({ where: { userId }, orderBy: { placedAt: 'desc' }, take, select: listSelect });
}

/** One order of an account, or null when it is someone else's: ids are never trusted on their own. */
export async function getOrderForUser(userId: string, orderId: string) {
  return prisma.order.findFirst({
    where: { id: orderId, userId },
    include: { lines: true, refunds: { select: { amountCents: true, createdAt: true } } },
  });
}

/** The order a checkout became, once payment.succeeded has been handled; null while it is still pending. */
export async function getOrderByCheckout(checkoutId: string) {
  return prisma.order.findUnique({ where: { checkoutId }, select: { id: true, number: true, email: true, totalCents: true, currency: true } });
}

/** Back office list. */
export async function listRecentOrders(options: { status?: OrderStatus; take?: number } = {}) {
  return prisma.order.findMany({
    where: options.status ? { status: options.status } : undefined,
    orderBy: { placedAt: 'desc' },
    take: options.take ?? 50,
    select: { ...listSelect, email: true },
  });
}

export async function getOrderForStaff(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: {
      lines: true,
      refunds: { include: { staff: { select: { name: true } } }, orderBy: { createdAt: 'desc' } },
      checkout: { include: { payments: { select: { id: true, status: true, amountCents: true, refundedCents: true, stripeIntentId: true } } } },
    },
  });
}

/** What sold most in the last days, by units, for the back office dashboard. */
export async function bestSellers(days = 30, take = 5) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.orderLine.groupBy({
    by: ['sku', 'name'],
    where: { order: { placedAt: { gte: since }, status: { not: 'CANCELLED' } } },
    _sum: { quantity: true, totalCents: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take,
  });
  return rows.map(r => ({ sku: r.sku, name: r.name, units: r._sum.quantity ?? 0, revenueCents: r._sum.totalCents ?? 0 }));
}
