import { prisma } from './db.js';

export async function tagItem(itemId, label) {
  return prisma.tag.create({ data: { itemId, label } });
}
