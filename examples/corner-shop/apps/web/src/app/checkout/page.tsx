import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { listAddresses, priceCart } from '@corner/orders';
import { CheckoutForm } from '@/components/checkout/CheckoutForm';
import { readCart, readDiscountCode } from '@/lib/cart-cookie';
import { currentCustomer } from '@/lib/customer';

export const metadata: Metadata = { title: 'Checkout', robots: { index: false } };

export default async function CheckoutPage() {
  const lines = await readCart();
  if (!lines.length) redirect('/cart');
  const customer = await currentCustomer();
  const [cart, addresses] = await Promise.all([
    priceCart(lines, await readDiscountCode()),
    customer ? listAddresses(customer.userId) : Promise.resolve([]),
  ]);
  return (
    <div className="checkout">
      <h1>Checkout</h1>
      <CheckoutForm cart={cart} email={customer?.email ?? null} addresses={addresses} />
    </div>
  );
}
