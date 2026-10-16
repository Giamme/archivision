import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProductForStaff } from '@corner/catalog';
import { StockEditor } from '@/components/admin/StockEditor';

export default async function AdminProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProductForStaff(id);
  if (!product) notFound();
  const rows = product.variants.map(v => ({
    sku: v.sku,
    productName: product.name,
    variantName: v.name,
    onHand: v.stock?.onHand ?? 0,
    reserved: v.stock?.reserved ?? 0,
    available: (v.stock?.onHand ?? 0) - (v.stock?.reserved ?? 0),
    updatedAt: v.stock?.updatedAt ?? product.updatedAt,
  }));
  return (
    <>
      <h1>{product.name}</h1>
      <p className="muted">
        {product.category.name} · {product.published ? <Link href={`/products/${product.slug}`}>shown in the shop</Link> : 'draft'}
      </p>
      <h2>Stock</h2>
      <StockEditor rows={rows} />
    </>
  );
}
