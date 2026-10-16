'use client';

import { useActionState } from 'react';
import { requestSignInLink } from '@/app/actions/account';

export function SignInForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(requestSignInLink, null);
  return (
    <form action={formAction} className="sign-in-form">
      <label>
        Email <input name="email" type="email" required autoComplete="email" autoFocus />
      </label>
      {next && <input type="hidden" name="next" value={next} />}
      <button className="button" disabled={pending}>
        {pending ? 'Sending…' : 'Email me a sign-in link'}
      </button>
      {state?.ok === false && <p className="error">{state.error}</p>}
      <p className="muted">No password needed. The link works once, for 15 minutes.</p>
    </form>
  );
}
