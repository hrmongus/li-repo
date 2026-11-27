'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { VERTICALS, isVertical, type Vertical } from '@/lib/outreach';

const KEY = 'vertical';

function readStored(): Vertical | null {
  try {
    const v = localStorage.getItem(KEY);
    return isVertical(v) ? v : null;
  } catch {
    return null;
  }
}

/** Mirror to a cookie so server components (queue, dashboard, upload) see the same choice. */
function writeCookie(v: Vertical) {
  document.cookie = `${KEY}=${v}; path=/; max-age=31536000; samesite=lax`;
}

/** Music | Apps toggle. Persisted in localStorage; every view filters on leads.vertical. */
export function VerticalSwitch({ current }: { current: Vertical }) {
  const router = useRouter();

  // On load: localStorage is the source of truth. If the cookie disagrees, sync it and re-render.
  useEffect(() => {
    const stored = readStored();
    if (stored && stored !== current) {
      writeCookie(stored);
      router.refresh();
    } else if (!stored) {
      try {
        localStorage.setItem(KEY, current);
      } catch {}
      writeCookie(current);
    }
  }, [current, router]);

  const pick = (v: Vertical) => {
    if (v === current) return;
    try {
      localStorage.setItem(KEY, v);
    } catch {}
    writeCookie(v);
    router.refresh();
  };

  return (
    <div className="flex overflow-hidden rounded border border-paper/30 text-xs font-bold uppercase tracking-[0.18em]">
      {VERTICALS.map((v) => (
        <button
          key={v}
          onClick={() => pick(v)}
          className={`px-3 py-1 ${v === current ? 'bg-brand-red text-white' : 'text-paper/70 hover:text-paper'}`}
        >
          {v === 'music' ? 'Music' : 'Apps'}
        </button>
      ))}
    </div>
  );
}
