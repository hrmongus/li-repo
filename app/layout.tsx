import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { signOut } from './actions';
import './globals.css';

export const metadata: Metadata = { title: 'Outreach CRM' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {user && (
          <header className="border-b border-slate-200 bg-white">
            <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3 text-sm">
              <Link href="/queue" className="font-semibold">Queue</Link>
              <Link href="/dashboard">Dashboard</Link>
              <Link href="/upload">Upload</Link>
              <form action={signOut} className="ml-auto">
                <button className="text-slate-500 hover:text-slate-900">Sign out</button>
              </form>
            </nav>
          </header>
        )}
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
