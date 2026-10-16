import Link from 'next/link';
import { formatDate, formatMoney, orderStatusLabel } from '@/lib/format';

export interface OrderRow {
  id: string;
  number: string;
  status: string;
  totalCents: number;
  currency: string;
  placedAt: Date;
  email?: string;
  _count: { lines: number };
}

/** Orders as a table; the back office passes `hrefBase="/admin/orders"` and sees the customer's email too. */
export function OrderTable({ orders, hrefBase = '/account/orders' }: { orders: OrderRow[]; hrefBase?: string }) {
  if (!orders.length) return <p className="muted">No orders yet.</p>;
  const staff = hrefBase.startsWith('/admin');
  return (
    <table className="data">
      <thead>
        <tr>
          <th>Order</th>
          <th>Placed</th>
          {staff && <th>Customer</th>}
          <th>Items</th>
          <th>Status</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        {orders.map(o => (
          <tr key={o.id}>
            <td>
              <Link href={`${hrefBase}/${o.id}`}>{o.number}</Link>
            </td>
            <td>{formatDate(o.placedAt)}</td>
            {staff && <td>{o.email}</td>}
            <td>{o._count.lines}</td>
            <td>{orderStatusLabel(o.status)}</td>
            <td>{formatMoney(o.totalCents, o.currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
