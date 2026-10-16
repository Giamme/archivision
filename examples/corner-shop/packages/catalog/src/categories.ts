import { prisma } from '@corner/db';

/** Top-level categories with their children, in shop order. Used by the header on every page. */
export async function listCategories() {
  return prisma.category.findMany({
    where: { parentId: null },
    orderBy: { position: 'asc' },
    include: { children: { orderBy: { position: 'asc' }, select: { id: true, slug: true, name: true } } },
  });
}

export async function getCategory(slug: string) {
  return prisma.category.findUnique({
    where: { slug },
    include: { parent: { select: { slug: true, name: true } }, children: { select: { id: true } } },
  });
}

/** The ids of a category and its direct children, so /categories/bags also lists /categories/totes. */
export function categoryIds(category: { id: string; children: Array<{ id: string }> }): string[] {
  return [category.id, ...category.children.map(c => c.id)];
}
