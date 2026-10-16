import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AddToCartButton } from '@/components/catalog/AddToCartButton';
import { cachedProduct } from '@/lib/catalog-cache';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const product = await cachedProduct((await params).slug);
  return product ? { title: product.name, description: product.description.slice(0, 150) } : {};
}

export default async function ProductPage({ params }: Params) {
  const { slug } = await params;
  const product = await cachedProduct(slug);
  if (!product) notFound();
  return (
    <article className="product">
      <nav className="muted" aria-label="Breadcrumb">
        <Link href={`/categories/${product.category.slug}`}>{product.category.name}</Link>
      </nav>
      {product.imageUrl && <Image src={product.imageUrl} alt={product.name} width={720} height={720} priority />}
      <div>
        <h1>{product.name}</h1>
        <p>{product.description}</p>
        <AddToCartButton variants={product.variants} currency={product.currency} />
      </div>
    </article>
  );
}
