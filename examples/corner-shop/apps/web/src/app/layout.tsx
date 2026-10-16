import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { listCategories } from '@corner/catalog';
import { Header } from '@/components/layout/Header';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Corner Shop', template: '%s · Corner Shop' },
  description: 'Everyday things, well made, sent from our corner.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const categories = await listCategories();
  return (
    <html lang="en">
      <body>
        <Header categories={categories} />
        <main className="container">{children}</main>
        <footer className="site-footer container">
          <p className="muted">Corner Shop · everyday things, well made.</p>
          <Link href="/products">All products</Link> · <Link href="/account">Your orders</Link> · <a href="mailto:hello@example.com">hello@example.com</a>
        </footer>
      </body>
    </html>
  );
}
