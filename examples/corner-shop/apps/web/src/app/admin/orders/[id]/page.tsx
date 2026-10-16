import { notFound } from 'next/navigation';
import { getOrderForStaff } from '@corner/orders';
import { RefundForm } from '@/components/admin/RefundForm';
import { formatDateTime, formatMoney, orderStatusLabel } from '@/lib/format';
import { staffOrRedirect } from '@/lib/staff';

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [staff, order] = await Promise.all([staffOrRedirect(), getOrderForStaff(id)]);
  if (!order) notFound();
  const payment = order.checkout.payments.find(p => p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED');
  const canRefund = staff.role === 'ADMIN' || staff.role === 'SUPPORT';
  return (
    <>
      <h1>Order {order.number}</h1>
      <p className="muted">
        {order.email} · {formatDateTime(order.placedAt)} · {orderStatusLabel(order.status)}
      </p>
      <table className="data">
        <tbody>
          {order.lines.map(line => (
            <tr key={line.id}>
              <td>{line.sku}</td>
              <td>{line.name}</td>
              <td>× {line.quantity}</td>
              <td>{formatMoney(line.totalCents, order.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>Total {formatMoney(order.totalCents, order.currency)}</p>
      <h2>Refunds</h2>
      <ul>
        {order.refunds.map(r => (
          <li key={r.id}>
            {formatMoney(r.amountCents, order.currency)} by {r.staff.name}, {formatDateTime(r.createdAt)}: {r.reason}
          </li>
        ))}
      </ul>
      {!payment && <p className="muted">No captured payment.</p>}
      {payment && canRefund && <RefundForm orderId={order.id} refundableCents={payment.amountCents - payment.refundedCents} currency={order.currency} />}
      {payment && !canRefund && <p className="muted">Refunds are done by support.</p>}
    </>
  );
}
