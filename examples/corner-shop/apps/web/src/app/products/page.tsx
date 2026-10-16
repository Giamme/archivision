import type { Metadata } from 'next';
import Link from 'next/link';
import { ProductGrid } from '@/components/catalog/ProductGrid';
import { cachedProducts } from '@/lib/catalog-cache';

export const metadata: Metadata = { title: 'All products' };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ after?: string }> }) {
  const { after } = await searchParams;
  const products = await cachedProducts(after);
  const last = products.at(-1);
  return (
    <>
      <h1>All products</h1>
      <ProductGrid products={products} />
      {last && products.length === 24 && (
        <Link href={`/products?after=${last.id}`} className="button">
          More
        </Link>
      )}
    </>
  );
}
