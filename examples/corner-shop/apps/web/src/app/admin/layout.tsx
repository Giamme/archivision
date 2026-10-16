import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { staffOrRedirect } from '@/lib/staff';

export const metadata: Metadata = { title: { default: 'Back office', template: '%s · Back office' }, robots: { index: false } };

const NAV = [
  { href: '/admin', label: 'Today' },
  { href: '/admin/orders', label: 'Orders' },
  { href: '/admin/products', label: 'Products' },
  { href: '/admin/stock', label: 'Stock' },
  { href: '/admin/refunds', label: 'Refunds' },
  { href: '/admin/discounts', label: 'Discount codes' },
];

/** Every back office page needs a staff session (Google Workspace sign-in); the pages check roles on top. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const staff = await staffOrRedirect();
  return (
    <div className="admin">
      <aside>
        <p>
          <strong>{staff.name}</strong>
          <br />
          <span className="muted">{staff.role.toLowerCase()}</span>
        </p>
        <nav aria-label="Back office">
          <ul>
            {NAV.map(item => (
              <li key={item.href}>
                <Link href={item.href}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <section>{children}</section>
    </div>
  );
}
