import { listLowStock } from '@corner/catalog';
import { bestSellers, listRecentOrders } from '@corner/orders';
import { OrderTable } from '@/components/account/OrderTable';
import { formatMoney } from '@/lib/format';

export default async function AdminHomePage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const { denied } = await searchParams;
  const [orders, sellers, low] = await Promise.all([listRecentOrders({ take: 10 }), bestSellers(7), listLowStock(5)]);
  return (
    <>
      {denied && <p className="error">Your role cannot do that. Ask an admin.</p>}
      <h1>Today</h1>
      <div className="admin-columns">
        <section>
          <h2>Best sellers this week</h2>
          <ol>
            {sellers.map(s => (
              <li key={s.sku}>
                {s.name}: {s.units} sold, {formatMoney(s.revenueCents)}
              </li>
            ))}
          </ol>
        </section>
        <section>
          <h2>Running low</h2>
          <ul>
            {low.map(s => (
              <li key={s.sku}>
                {s.sku}: {s.onHand} on hand, {s.reserved} held
              </li>
            ))}
          </ul>
        </section>
      </div>
      <h2>Latest orders</h2>
      <OrderTable orders={orders} hrefBase="/admin/orders" />
    </>
  );
}
