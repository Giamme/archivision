import { prisma } from './db';
import { total } from './money';

export async function listOrders() {
  return prisma.order.findMany();
}

export async function placeOrder(lines: { price: number; qty: number }[]) {
  return prisma.order.create({ data: { total: total(lines) } });
}
