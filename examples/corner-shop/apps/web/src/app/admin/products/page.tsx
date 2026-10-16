import type { Metadata } from 'next';
import Link from 'next/link';
import { listProductsForStaff } from '@corner/catalog';
import { formatDate } from '@/lib/format';

export const metadata: Metadata = { title: 'Products' };

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const products = await listProductsForStaff(q);
  return (
    <>
      <h1>Products</h1>
      <form className="inline-form">
        <input name="q" type="search" defaultValue={q} placeholder="Filter by name" />
      </form>
      <table className="data">
        <thead>
          <tr>
            <th>Name</th>
            <th>Category</th>
            <th>Variants</th>
            <th>Shown</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {products.map(p => (
            <tr key={p.id}>
              <td>
                <Link href={`/admin/products/${p.id}`}>{p.name}</Link>
              </td>
              <td>{p.category.name}</td>
              <td>{p._count.variants}</td>
              <td>{p.published ? 'Yes' : 'Draft'}</td>
              <td>{formatDate(p.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
