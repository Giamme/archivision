import { prisma } from '@/lib/db';

export async function listProducts() {
  return prisma.product.findMany();
}

export async function getProduct(id: string) {
  return prisma.product.findUnique({ where: { id } });
}
