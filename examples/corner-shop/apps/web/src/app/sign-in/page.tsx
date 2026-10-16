import type { Metadata } from 'next';
import { SignInForm } from '@/components/sign-in/SignInForm';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; expired?: string }> }) {
  const { next, expired } = await searchParams;
  return (
    <div className="narrow">
      <h1>Sign in</h1>
      {expired && <p className="error">That link has expired or was already used. Ask for a new one.</p>}
      <p>We will email you a link. Your orders and addresses are waiting on the other side.</p>
      <SignInForm next={next?.startsWith('/') ? next : undefined} />
    </div>
  );
}
