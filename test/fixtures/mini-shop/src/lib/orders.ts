import { prisma } from '@/lib/db';

export type NewOrder = { email: string; lines: { productId: string; qty: number }[] };

/** Creates an order with its lines. */
export async function createOrder(input: NewOrder) {
  return prisma.order.create({ data: { email: input.email, lines: { create: input.lines } } });
}

export async function listOrders(email: string) {
  return prisma.order.findMany({ where: { email } });
}
