import Image from 'next/image';
import Link from 'next/link';
import type { ProductSummary } from '@corner/catalog';
import { formatMoney } from '@/lib/format';

export function ProductCard({ product }: { product: ProductSummary }) {
  return (
    <article className="card product-card">
      <Link href={`/products/${product.slug}`}>
        {product.imageUrl ? (
          <Image src={product.imageUrl} alt="" width={480} height={480} sizes="(max-width: 600px) 50vw, 240px" />
        ) : (
          <div className="image-placeholder" aria-hidden />
        )}
        <h3>{product.name}</h3>
      </Link>
      <p className="price">
        {product.fromPriceCents === null ? 'Coming soon' : `from ${formatMoney(product.fromPriceCents, product.currency)}`}
        {!product.inStock && <span className="muted"> · sold out</span>}
      </p>
    </article>
  );
}
