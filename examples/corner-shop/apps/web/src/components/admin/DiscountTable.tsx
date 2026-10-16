'use client';

import { useActionState } from 'react';
import type { Discount } from '@corner/db';
import { saveDiscountAction, toggleDiscount } from '@/app/actions/admin-discounts';
import { formatDate, formatMoney } from '@/lib/format';

function describe(d: Discount): string {
  const off = d.kind === 'PERCENT' ? `${d.value}% off` : `${formatMoney(d.value)} off`;
  return d.minTotalCents ? `${off} from ${formatMoney(d.minTotalCents)}` : off;
}

export function DiscountTable({ discounts }: { discounts: Discount[] }) {
  const [state, formAction, pending] = useActionState(saveDiscountAction, null);
  return (
    <>
      <table className="data">
        <thead>
          <tr>
            <th>Code</th>
            <th>Discount</th>
            <th>Used</th>
            <th>Ends</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {discounts.map(d => (
            <tr key={d.id} className={d.active ? undefined : 'muted'}>
              <td>{d.code}</td>
              <td>{describe(d)}</td>
              <td>
                {d.redemptions}
                {d.maxRedemptions !== null && ` / ${d.maxRedemptions}`}
              </td>
              <td>{d.endsAt ? formatDate(d.endsAt) : '—'}</td>
              <td>
                <form action={toggleDiscount}>
                  <input type="hidden" name="id" value={d.id} />
                  <input type="hidden" name="active" value={String(!d.active)} />
                  <button className="link-button">{d.active ? 'Switch off' : 'Switch on'}</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form action={formAction} className="discount-new">
        <h3>New code</h3>
        <input name="code" required placeholder="SPRING-15" pattern="[A-Za-z0-9-]{3,24}" />
        <select name="kind" defaultValue="PERCENT">
          <option value="PERCENT">Percent</option>
          <option value="FIXED">Amount (€)</option>
        </select>
        <input name="value" required placeholder="15" />
        <input name="minTotal" placeholder="Minimum order (€)" />
        <input name="maxRedemptions" type="number" min={1} placeholder="Uses (blank: no limit)" />
        <input name="endsAt" type="date" />
        <button className="button" disabled={pending}>
          Save code
        </button>
        {state?.ok === false && <p className="error">{state.error}</p>}
      </form>
    </>
  );
}
