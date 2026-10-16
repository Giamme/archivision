import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProductGrid } from '@/components/catalog/ProductGrid';
import { cachedCategory } from '@/lib/catalog-cache';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const found = await cachedCategory((await params).slug);
  return found ? { title: found.category.name } : {};
}

export default async function CategoryPage({ params }: Params) {
  const found = await cachedCategory((await params).slug);
  if (!found) notFound();
  const { category, products } = found;
  return (
    <>
      {category.parent && (
        <nav className="muted" aria-label="Breadcrumb">
          <Link href={`/categories/${category.parent.slug}`}>{category.parent.name}</Link>
        </nav>
      )}
      <h1>{category.name}</h1>
      <ProductGrid products={products} empty="Nothing in this category yet." />
    </>
  );
}
