import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { signOut } from './actions';
import './globals.css';

export const metadata: Metadata = { title: 'Propagandistan CRM' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className="min-h-screen antialiased">
        {user && (
          <header className="bg-ink text-paper">
            <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
              <Link href="/queue" className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 rounded-full bg-brand-red" />
                <span className="text-lg font-bold uppercase tracking-tight">Propagandistan</span>
              </Link>
              <div className="flex gap-5 text-xs font-bold uppercase tracking-[0.18em]">
                <Link href="/queue" className="hover:text-brand-red">Queue</Link>
                <Link href="/dashboard" className="hover:text-brand-red">Dashboard</Link>
                <Link href="/upload" className="hover:text-brand-red">Upload</Link>
              </div>
              <form action={signOut} className="ml-auto">
                <button className="text-xs uppercase tracking-[0.18em] text-paper/60 hover:text-paper">Sign out</button>
              </form>
            </nav>
          </header>
        )}
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
