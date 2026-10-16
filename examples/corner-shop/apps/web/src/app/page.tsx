import Link from 'next/link';
import { listCategories, listFeaturedProducts, listProducts } from '@corner/catalog';
import { ProductGrid } from '@/components/catalog/ProductGrid';

export default async function HomePage() {
  const [featured, latest, categories] = await Promise.all([listFeaturedProducts(8), listProducts({ take: 4 }), listCategories()]);
  return (
    <>
      <section className="hero">
        <h1>Everyday things, well made.</h1>
        <p className="muted">Free shipping inside the EU from €60.</p>
        <Link href="/products" className="button">
          Shop everything
        </Link>
      </section>
      <section>
        <h2>Shop by category</h2>
        <ul className="category-tiles">
          {categories.map(c => (
            <li key={c.id}>
              <Link href={`/categories/${c.slug}`}>{c.name}</Link>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Picked for you</h2>
        <ProductGrid products={featured} />
      </section>
      <section>
        <h2>New in</h2>
        <ProductGrid products={latest} />
      </section>
    </>
  );
}
