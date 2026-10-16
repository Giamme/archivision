import type { Metadata } from 'next';
import Link from 'next/link';
import { listRefunds } from '@corner/payments';
import { formatDateTime, formatMoney } from '@/lib/format';
import { staffOrRedirect } from '@/lib/staff';

export const metadata: Metadata = { title: 'Refunds' };

export default async function AdminRefundsPage() {
  await staffOrRedirect(['SUPPORT']);
  const refunds = await listRefunds();
  return (
    <>
      <h1>Refunds</h1>
      <p className="muted">Refunds start from an order. They are kept by the Payment service and sent through Stripe.</p>
      <table className="data">
        <thead>
          <tr>
            <th>When</th>
            <th>Order</th>
            <th>Amount</th>
            <th>By</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {refunds.map(r => (
            <tr key={r.id}>
              <td>{formatDateTime(r.createdAt)}</td>
              <td>
                <Link href={`/admin/orders/${r.order.id}`}>{r.order.number}</Link>
              </td>
              <td>{formatMoney(r.amountCents, r.order.currency)}</td>
              <td>{r.staff.name}</td>
              <td>{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
