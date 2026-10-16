import type { Metadata } from 'next';
import Link from 'next/link';
import { PricingError, priceCart } from '@corner/orders';
import { CartSummary } from '@/components/cart/CartSummary';
import { readCart, readDiscountCode } from '@/lib/cart-cookie';

export const metadata: Metadata = { title: 'Your cart' };

export default async function CartPage() {
  const lines = await readCart();
  if (!lines.length) {
    return (
      <>
        <h1>Your cart</h1>
        <p>It is empty.</p>
        <Link href="/products">Find something you like</Link>
      </>
    );
  }
  try {
    const cart = await priceCart(lines, await readDiscountCode());
    return (
      <>
        <h1>Your cart</h1>
        <CartSummary cart={cart} />
      </>
    );
  } catch (err) {
    if (!(err instanceof PricingError)) throw err;
    return (
      <>
        <h1>Your cart</h1>
        <p className="error">{err.sku ? `${err.sku} is no longer for sale. Remove it to continue.` : err.message}</p>
      </>
    );
  }
}
