import type { Metadata } from 'next';
import Link from 'next/link';
import { listRecentOrders } from '@corner/orders';
import { OrderTable } from '@/components/account/OrderTable';

export const metadata: Metadata = { title: 'Orders' };

const FILTERS = ['CONFIRMED', 'SHIPPED', 'CANCELLED'] as const;

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const filter = FILTERS.find(f => f === status);
  const orders = await listRecentOrders({ status: filter, take: 100 });
  return (
    <>
      <h1>Orders</h1>
      <nav className="filters">
        <Link href="/admin/orders">All</Link>
        {FILTERS.map(f => (
          <Link key={f} href={`/admin/orders?status=${f}`} aria-current={f === filter ? 'page' : undefined}>
            {f.toLowerCase()}
          </Link>
        ))}
      </nav>
      <OrderTable orders={orders} hrefBase="/admin/orders" />
    </>
  );
}
