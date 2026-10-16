import type { Metadata } from 'next';
import { searchProducts } from '@corner/catalog';
import { ProductGrid } from '@/components/catalog/ProductGrid';
import { SearchBox } from '@/components/catalog/SearchBox';

export const metadata: Metadata = { title: 'Search', robots: { index: false } };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams;
  const results = await searchProducts(q);
  return (
    <>
      <h1>{q ? `Results for “${q}”` : 'Search'}</h1>
      <SearchBox query={q} />
      <ProductGrid products={results} empty={q.trim().length < 2 ? 'Type at least two letters.' : 'Nothing matches. Try another word, or a SKU.'} />
    </>
  );
}
