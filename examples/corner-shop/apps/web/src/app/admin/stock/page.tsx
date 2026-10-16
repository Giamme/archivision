import type { Metadata } from 'next';
import { listStock } from '@corner/catalog';
import { StockEditor } from '@/components/admin/StockEditor';
import { staffOrRedirect } from '@/lib/staff';

export const metadata: Metadata = { title: 'Stock' };

export default async function AdminStockPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await staffOrRedirect(['STOCK']);
  const { q } = await searchParams;
  const rows = await listStock(q);
  return (
    <>
      <h1>Stock</h1>
      <p className="muted">Type what you counted on the shelf. Units held for open checkouts are added on top of what is available.</p>
      <form className="inline-form">
        <input name="q" type="search" defaultValue={q} placeholder="SKU or product" />
      </form>
      <StockEditor rows={rows} />
    </>
  );
}
