import { prisma } from '@/lib/db';

export async function listProducts() {
  return prisma.product.findMany();
}

export async function updateStock(sku: string, stock: number) {
  return prisma.product.update({ where: { sku }, data: { stock } });
}
