import { prisma, type Prisma } from '@corner/db';
import { categoryIds, getCategory } from './categories';

export interface ProductSummary {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  /** The cheapest variant's price in the active price list; null when none is priced yet. */
  fromPriceCents: number | null;
  currency: string;
  inStock: boolean;
}

export interface VariantDetail {
  id: string;
  sku: string;
  name: string;
  weightGrams: number;
  priceCents: number | null;
  available: number;
}

export interface ProductDetail extends ProductSummary {
  description: string;
  category: { slug: string; name: string };
  variants: VariantDetail[];
}

export interface ListOptions {
  take?: number;
  cursor?: string;
  featured?: boolean;
  categoryId?: string;
}

const PAGE_SIZE = 24;

// what every product list needs: the price in the active price list, and whether anything is left to sell
const summarySelect = {
  id: true,
  slug: true,
  name: true,
  imageUrl: true,
  variants: {
    select: {
      stock: { select: { onHand: true, reserved: true } },
      prices: { where: { priceList: { active: true } }, select: { amountCents: true, priceList: { select: { currency: true } } } },
    },
  },
} satisfies Prisma.ProductSelect;

type SummaryRow = Prisma.ProductGetPayload<{ select: typeof summarySelect }>;

export function toSummary(row: SummaryRow): ProductSummary {
  const prices = row.variants.flatMap(v => v.prices);
  const cheapest = prices.reduce<(typeof prices)[number] | null>((min, p) => (!min || p.amountCents < min.amountCents ? p : min), null);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    imageUrl: row.imageUrl,
    fromPriceCents: cheapest?.amountCents ?? null,
    currency: cheapest?.priceList.currency ?? 'EUR',
    inStock: row.variants.some(v => (v.stock?.onHand ?? 0) - (v.stock?.reserved ?? 0) > 0),
  };
}

export async function listProducts(options: ListOptions = {}): Promise<ProductSummary[]> {
  const rows = await prisma.product.findMany({
    where: { published: true, featured: options.featured || undefined, categoryId: options.categoryId },
    orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
    take: options.take ?? PAGE_SIZE,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    select: summarySelect,
  });
  return rows.map(toSummary);
}

export async function listFeaturedProducts(take = 8): Promise<ProductSummary[]> {
  return listProducts({ featured: true, take });
}

/** A category page: the category, and the published products in it and in its children. */
export async function listByCategory(slug: string, options: ListOptions = {}) {
  const category = await getCategory(slug);
  if (!category) return null;
  const rows = await prisma.product.findMany({
    where: { published: true, categoryId: { in: categoryIds(category) } },
    orderBy: { name: 'asc' },
    take: options.take ?? PAGE_SIZE,
    select: summarySelect,
  });
  return { category, products: rows.map(toSummary) };
}

/** Name and description match, or an exact SKU. Short queries return nothing rather than the whole shop. */
export async function searchProducts(query: string, take = PAGE_SIZE): Promise<ProductSummary[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const rows = await prisma.product.findMany({
    where: {
      published: true,
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { variants: { some: { sku: q.toUpperCase() } } },
      ],
    },
    take,
    select: summarySelect,
  });
  return rows.map(toSummary);
}

export async function getProduct(slug: string): Promise<ProductDetail | null> {
  const row = await prisma.product.findUnique({
    where: { slug },
    include: {
      category: { select: { slug: true, name: true } },
      variants: {
        orderBy: { name: 'asc' },
        include: { stock: true, prices: { where: { priceList: { active: true } }, include: { priceList: { select: { currency: true } } } } },
      },
    },
  });
  if (!row || !row.published) return null;
  const variants = row.variants.map(v => ({
    id: v.id,
    sku: v.sku,
    name: v.name,
    weightGrams: v.weightGrams,
    priceCents: v.prices[0]?.amountCents ?? null,
    available: Math.max(0, (v.stock?.onHand ?? 0) - (v.stock?.reserved ?? 0)),
  }));
  const priced = variants.filter(v => v.priceCents !== null);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    imageUrl: row.imageUrl,
    category: row.category,
    variants,
    fromPriceCents: priced.length ? Math.min(...priced.map(v => v.priceCents as number)) : null,
    currency: row.variants[0]?.prices[0]?.priceList.currency ?? 'EUR',
    inStock: variants.some(v => v.available > 0),
  };
}

/** Back office: every product, published or not, with its variant count. */
export async function listProductsForStaff(query?: string) {
  return prisma.product.findMany({
    where: query ? { name: { contains: query, mode: 'insensitive' } } : undefined,
    orderBy: { updatedAt: 'desc' },
    include: { category: { select: { name: true } }, _count: { select: { variants: true } } },
  });
}

export async function getProductForStaff(id: string) {
  return prisma.product.findUnique({
    where: { id },
    include: { category: true, variants: { orderBy: { sku: 'asc' }, include: { stock: true } } },
  });
}

export async function setPublished(id: string, published: boolean) {
  return prisma.product.update({ where: { id }, data: { published } });
}
