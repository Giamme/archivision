'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import type { PricedCart } from '@corner/orders';
import { applyDiscountCode, removeCartLine, updateCartLine } from '@/app/actions/cart';
import { formatMoney } from '@/lib/format';

export function CartSummary({ cart }: { cart: PricedCart }) {
  const [discount, applyCode, applying] = useActionState(applyDiscountCode, null);
  return (
    <div className="cart">
      <table className="data">
        <thead>
          <tr>
            <th>Item</th>
            <th>Quantity</th>
            <th>Total</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {cart.lines.map(line => (
            <tr key={line.sku}>
              <td>
                {line.name}
                <div className="muted">{line.sku}</div>
              </td>
              <td>
                <form action={updateCartLine}>
                  <input type="hidden" name="sku" value={line.sku} />
                  <input type="number" name="quantity" min={0} max={20} defaultValue={line.quantity} aria-label={`Quantity of ${line.name}`} />
                  <button className="link-button">Update</button>
                </form>
              </td>
              <td>{formatMoney(line.totalCents, cart.currency)}</td>
              <td>
                <form action={removeCartLine}>
                  <input type="hidden" name="sku" value={line.sku} />
                  <button className="link-button">Remove</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <aside className="cart-totals">
        <form action={applyCode} className="discount-form">
          <label htmlFor="discount-code">Discount code</label>
          <input id="discount-code" name="code" defaultValue={cart.discount?.code ?? ''} autoComplete="off" />
          <button className="button" disabled={applying}>
            Apply
          </button>
          {discount?.ok === false && <p className="error">{discount.error}</p>}
          {discount?.ok && <p role="status">{discount.code} applied.</p>}
        </form>
        <dl>
          <dt>Subtotal</dt>
          <dd>{formatMoney(cart.subtotalCents, cart.currency)}</dd>
          {cart.discountCents > 0 && (
            <>
              <dt>Discount ({cart.discount?.code})</dt>
              <dd>−{formatMoney(cart.discountCents, cart.currency)}</dd>
            </>
          )}
          <dt>Shipping</dt>
          <dd>{cart.shippingCents === 0 ? 'Free' : formatMoney(cart.shippingCents, cart.currency)}</dd>
          <dt>Total</dt>
          <dd className="total">{formatMoney(cart.totalCents, cart.currency)}</dd>
        </dl>
        <Link href="/checkout" className="button">
          Go to checkout
        </Link>
      </aside>
    </div>
  );
}
