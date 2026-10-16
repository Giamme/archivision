'use client';

import { useActionState, useState } from 'react';
import type { VariantDetail } from '@corner/catalog';
import { addToCart } from '@/app/actions/cart';
import { formatMoney } from '@/lib/format';

export function AddToCartButton({ variants, currency }: { variants: VariantDetail[]; currency: string }) {
  const [state, formAction, pending] = useActionState(addToCart, null);
  const firstAvailable = variants.find(v => v.available > 0) ?? variants[0];
  const [sku, setSku] = useState(firstAvailable?.sku ?? '');
  const chosen = variants.find(v => v.sku === sku);

  return (
    <form action={formAction} className="add-to-cart">
      {variants.length > 1 && (
        <fieldset>
          <legend>Choose</legend>
          {variants.map(v => (
            <label key={v.sku} className="variant-option">
              <input type="radio" name="sku" value={v.sku} checked={sku === v.sku} disabled={v.available === 0} onChange={() => setSku(v.sku)} />
              {v.name}
              {v.available === 0 && ' (sold out)'}
            </label>
          ))}
        </fieldset>
      )}
      {variants.length === 1 && <input type="hidden" name="sku" value={sku} />}
      <label>
        Quantity <input type="number" name="quantity" min={1} max={chosen?.available ?? 1} defaultValue={1} />
      </label>
      <button className="button" disabled={pending || !chosen || chosen.available === 0}>
        {pending ? 'Adding…' : chosen?.priceCents ? `Add to cart · ${formatMoney(chosen.priceCents, currency)}` : 'Add to cart'}
      </button>
      {state?.ok === false && <p className="error">{state.error}</p>}
      {state?.ok && <p role="status">Added. {state.count} in your cart.</p>}
    </form>
  );
}
