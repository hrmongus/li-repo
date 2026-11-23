'use client';

import { useEffect } from 'react';

/** Remembers the chosen queue tab (profile) in a cookie, so each setter stays on their own tab. */
export function RememberTab({ tab }: { tab: string }) {
  useEffect(() => {
    document.cookie = `queue_tab=${encodeURIComponent(tab)}; path=/; max-age=31536000; samesite=lax`;
  }, [tab]);
  return null;
}
