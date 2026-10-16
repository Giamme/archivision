'use client';

import { useActionState } from 'react';
import type { StockRow } from '@corner/catalog';
import { updateStock } from '@/app/actions/admin-stock';
import { formatDateTime } from '@/lib/format';

/** One row per SKU: staff type the counted quantity and save it; reserved units are shown, not editable. */
export function StockEditor({ rows }: { rows: StockRow[] }) {
  return (
    <table className="data stock-editor">
      <thead>
        <tr>
          <th>SKU</th>
          <th>Product</th>
          <th>Reserved</th>
          <th>Available</th>
          <th>On hand</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <StockRowForm key={row.sku} row={row} />
        ))}
      </tbody>
    </table>
  );
}

function StockRowForm({ row }: { row: StockRow }) {
  const [state, formAction, pending] = useActionState(updateStock, null);
  const onHand = state?.ok ? state.onHand : row.onHand;
  return (
    <tr className={row.available <= 0 ? 'low' : undefined}>
      <td>{row.sku}</td>
      <td>
        {row.productName} · {row.variantName}
      </td>
      <td>{row.reserved}</td>
      <td>{onHand - row.reserved}</td>
      <td>
        <form action={formAction} className="inline-form">
          <input type="hidden" name="sku" value={row.sku} />
          <input type="number" name="onHand" min={row.reserved} defaultValue={onHand} aria-label={`On hand for ${row.sku}`} />
          <button className="button" disabled={pending}>
            Save
          </button>
          {state?.ok === false && <span className="error">{state.error}</span>}
        </form>
      </td>
      <td className="muted">{formatDateTime(row.updatedAt)}</td>
    </tr>
  );
}
