import type { ProductSummary } from '@corner/catalog';
import { ProductCard } from './ProductCard';

export function ProductGrid({ products, empty = 'Nothing here yet.' }: { products: ProductSummary[]; empty?: string }) {
  if (!products.length) return <p className="muted">{empty}</p>;
  return (
    <div className="grid">
      {products.map(p => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}
