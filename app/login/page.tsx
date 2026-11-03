'use client';

import { useActionState } from 'react';
import { signIn } from './actions';

export default function LoginPage() {
  const [error, action, pending] = useActionState(signIn, null);
  return (
    <form action={action} className="mx-auto mt-24 flex max-w-sm flex-col gap-3 rounded-lg border border-slate-200 bg-white p-6">
      <h1 className="text-lg font-semibold">Sign in</h1>
      <input name="email" type="email" required placeholder="Email" autoComplete="email"
        className="rounded border border-slate-300 px-3 py-2" />
      <input name="password" type="password" required placeholder="Password" autoComplete="current-password"
        className="rounded border border-slate-300 px-3 py-2" />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={pending} className="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50">
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
