import type { Metadata } from 'next';
import Link from 'next/link';
import { listAddresses } from '@corner/orders';
import { deleteAddressAction, saveAddressAction } from '@/app/actions/account';
import { AddressForm } from '@/components/checkout/AddressForm';
import { customerOrRedirect } from '@/lib/customer';

export const metadata: Metadata = { title: 'Addresses' };

export default async function AddressesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const customer = await customerOrRedirect('/account/addresses');
  const [addresses, { error }] = await Promise.all([listAddresses(customer.userId), searchParams]);
  return (
    <>
      <Link href="/account" className="muted">
        ← Your account
      </Link>
      <h1>Addresses</h1>
      <ul className="address-list">
        {addresses.map(a => (
          <li key={a.id} className="card">
            <strong>{a.label ?? a.name}</strong>
            {a.isDefault && <span className="badge">Default</span>}
            <p>
              {a.line1}
              {a.line2 && `, ${a.line2}`}, {a.postalCode} {a.city}, {a.country}
            </p>
            <form action={deleteAddressAction}>
              <input type="hidden" name="id" value={a.id} />
              <button className="link-button">Delete</button>
            </form>
          </li>
        ))}
      </ul>
      <h2>Add an address</h2>
      <form action={saveAddressAction} className="address-book-form">
        <AddressForm withLabel />
        <label>
          <input type="checkbox" name="isDefault" /> Use this address by default
        </label>
        {error && <p className="error">Fill in name, street, city, postcode and country.</p>}
        <button className="button">Save address</button>
      </form>
    </>
  );
}
