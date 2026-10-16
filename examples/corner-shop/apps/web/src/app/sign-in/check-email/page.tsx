import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Check your email' };

export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return (
    <div className="narrow">
      <h1>Check your email</h1>
      <p>
        We sent a sign-in link to <strong>{email ?? 'your address'}</strong>. It works once, for the next 15 minutes.
      </p>
      <p className="muted">
        Nothing there? Look in spam, or <Link href="/sign-in">try again</Link>.
      </p>
    </div>
  );
}
