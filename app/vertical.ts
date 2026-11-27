import { cookies } from 'next/headers';
import { isVertical, type Vertical } from '@/lib/outreach';

/**
 * The vertical (Music | Apps) the user is working in. The switcher in the header keeps it in
 * localStorage and mirrors it to this cookie so server components can filter on leads.vertical.
 */
export async function getVertical(): Promise<Vertical> {
  const v = (await cookies()).get('vertical')?.value;
  return isVertical(v) ? v : 'music';
}
