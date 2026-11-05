'use client';

import { useActionState } from 'react';
import { signIn } from './actions';

export default function LoginPage() {
  const [error, action, pending] = useActionState(signIn, null);
  return (
    <form action={action} className="mx-auto mt-24 flex max-w-sm flex-col gap-3 rounded-lg border border-slate-200 bg-white p-6">
      <div className="flex items-center gap-2">
        <span className="h-3.5 w-3.5 rounded-full bg-brand-red" />
        <span className="text-lg font-bold uppercase tracking-tight">Propagandistan</span>
      </div>
      <h1 className="text-sm text-slate-500">Sign in to the outreach CRM</h1>
      <input name="email" type="email" required placeholder="Email" autoComplete="email"
        className="rounded border border-slate-300 px-3 py-2" />
      <input name="password" type="password" required placeholder="Password" autoComplete="current-password"
        className="rounded border border-slate-300 px-3 py-2" />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={pending} className="rounded bg-brand-red px-3 py-2 font-semibold text-white hover:opacity-90 disabled:opacity-50">
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
