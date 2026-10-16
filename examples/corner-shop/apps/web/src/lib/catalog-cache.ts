import { unstable_cache } from 'next/cache';
import { getProduct, listByCategory, listProducts } from '@corner/catalog';

// Catalog reads are cached and tagged; /api/revalidate drops the tags when stock.changed arrives from the bus.
export const CATALOG_TAG = 'catalog';
export const productTag = (slug: string) => `product:${slug}`;

/** Runs a catalog read through Next's data cache under a key and tags. */
function tagged<T>(read: () => Promise<T>, key: string[], tags: string[], revalidate = 600): Promise<T> {
  return unstable_cache(read, key, { tags: [CATALOG_TAG, ...tags], revalidate })();
}

export function cachedProduct(slug: string) {
  return tagged(() => getProduct(slug), ['product', slug], [productTag(slug)], 3600);
}

export function cachedProducts(cursor?: string) {
  return tagged(() => listProducts({ cursor }), ['products', cursor ?? 'first'], []);
}

export function cachedCategory(slug: string) {
  return tagged(() => listByCategory(slug), ['category', slug], []);
}
