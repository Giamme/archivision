import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getOrderForUser } from '@corner/orders';
import { customerOrRedirect } from '@/lib/customer';
import { formatDate, formatMoney, orderStatusLabel } from '@/lib/format';

export const metadata: Metadata = { title: 'Order' };

export default async function AccountOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = await customerOrRedirect(`/account/orders/${id}`);
  const order = await getOrderForUser(customer.userId, id);
  if (!order) notFound();
  const refunded = order.refunds.reduce((sum, r) => sum + r.amountCents, 0);
  return (
    <>
      <Link href="/account" className="muted">
        ← Your orders
      </Link>
      <h1>Order {order.number}</h1>
      <p className="muted">
        Placed {formatDate(order.placedAt)} · {orderStatusLabel(order.status)}
        {order.shippedAt && ` · shipped ${formatDate(order.shippedAt)}`}
      </p>
      <table className="data">
        <tbody>
          {order.lines.map(line => (
            <tr key={line.id}>
              <td>{line.name}</td>
              <td>× {line.quantity}</td>
              <td>{formatMoney(line.totalCents, order.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Shipping {formatMoney(order.shippingCents, order.currency)} · Total <strong>{formatMoney(order.totalCents, order.currency)}</strong>
      </p>
      {refunded > 0 && <p>Refunded {formatMoney(refunded, order.currency)}</p>}
    </>
  );
}
