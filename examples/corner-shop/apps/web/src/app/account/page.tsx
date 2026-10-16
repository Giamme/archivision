import type { Metadata } from 'next';
import Link from 'next/link';
import { listOrdersForUser } from '@corner/orders';
import { signOut } from '@/app/actions/account';
import { OrderTable } from '@/components/account/OrderTable';
import { customerOrRedirect } from '@/lib/customer';

export const metadata: Metadata = { title: 'Your account' };

export default async function AccountPage() {
  const customer = await customerOrRedirect('/account');
  const orders = await listOrdersForUser(customer.userId);
  return (
    <div className="account">
      <header className="account-header">
        <p className="muted">Signed in as {customer.email}</p>
        <Link href="/account/addresses">Addresses</Link>
        <form action={signOut}>
          <button className="link-button">Sign out</button>
        </form>
      </header>
      <h1>Your orders</h1>
      <OrderTable orders={orders} />
    </div>
  );
}
