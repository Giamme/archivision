'use client';

import { useActionState } from 'react';
import { issueRefund } from '@/app/actions/admin-refunds';
import { formatMoney } from '@/lib/format';

export function RefundForm({ orderId, refundableCents, currency }: { orderId: string; refundableCents: number; currency: string }) {
  const [state, formAction, pending] = useActionState(issueRefund, null);
  if (refundableCents <= 0) return <p className="muted">Fully refunded.</p>;
  return (
    <form action={formAction} className="refund-form">
      <h3>Refund</h3>
      <input type="hidden" name="orderId" value={orderId} />
      <label>
        Amount (up to {formatMoney(refundableCents, currency)})
        <input name="amount" inputMode="decimal" required placeholder={(refundableCents / 100).toFixed(2)} />
      </label>
      <label>
        Reason, shown to the customer <input name="reason" required maxLength={200} />
      </label>
      <button className="button" disabled={pending}>
        {pending ? 'Refunding…' : 'Refund through Stripe'}
      </button>
      {state?.ok === false && <p className="error">{state.error}</p>}
      {state?.ok && <p role="status">Refund {state.refundId} created.</p>}
    </form>
  );
}
