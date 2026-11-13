// "Show all" panel on a lead card: every lead and artist column, which ones can be edited there,
// and how typed input is turned into a database value. Pure functions, no I/O.
import { normalizeLinkedinUrl } from './leads';

export type FieldKind = 'text' | 'longtext' | 'int' | 'date' | 'timestamp' | 'select' | 'bool';

export interface Field {
  key: string;
  kind: FieldKind;
  /** false = shown but changed only by the workflow (buttons, research), never in this panel. */
  editable: boolean;
  options?: string[];
}

export const COMPANY_TYPES = ['label', 'management', 'agency', 'distributor', 'other'];

export const LEAD_FIELDS: Field[] = [
  { key: 'full_name', kind: 'text', editable: true },
  { key: 'first_name', kind: 'text', editable: true },
  { key: 'title', kind: 'text', editable: true },
  { key: 'company_name', kind: 'text', editable: true },
  { key: 'company_type', kind: 'select', editable: true, options: COMPANY_TYPES },
  { key: 'company_website', kind: 'text', editable: true },
  { key: 'company_socials', kind: 'text', editable: true },
  { key: 'linkedin_url', kind: 'text', editable: true },
  { key: 'email', kind: 'text', editable: true },
  { key: 'country', kind: 'text', editable: true },
  { key: 'company_staff', kind: 'int', editable: true },
  { key: 'top_artist_listeners', kind: 'int', editable: true },
  { key: 'plan_url', kind: 'text', editable: true },
  { key: 'notes', kind: 'longtext', editable: true },
  // Workflow fields: changed by the step buttons, the LinkedIn check or research only.
  { key: 'status', kind: 'text', editable: false },
  { key: 'next_action_at', kind: 'date', editable: false },
  { key: 'status_changed_at', kind: 'timestamp', editable: false },
  { key: 'research_status', kind: 'text', editable: false },
  { key: 'disqualify_reason', kind: 'text', editable: false },
  { key: 'last_li_activity', kind: 'date', editable: false },
  { key: 'li_checked_at', kind: 'date', editable: false },
  { key: 'plan_sent_at', kind: 'timestamp', editable: false },
  { key: 'created_at', kind: 'timestamp', editable: false },
  { key: 'id', kind: 'text', editable: false },
];

export const ARTIST_FIELDS: Field[] = [
  { key: 'name', kind: 'text', editable: true },
  { key: 'spotify_url', kind: 'text', editable: true },
  { key: 'monthly_listeners', kind: 'int', editable: true },
  { key: 'latest_release_title', kind: 'text', editable: true },
  { key: 'genre', kind: 'text', editable: true },
  { key: 'top_cities', kind: 'text', editable: true },
  { key: 'instagram_url', kind: 'text', editable: true },
  { key: 'instagram_followers', kind: 'int', editable: true },
  { key: 'tiktok_url', kind: 'text', editable: true },
  { key: 'tiktok_followers', kind: 'int', editable: true },
  { key: 'notes', kind: 'longtext', editable: true },
  { key: 'is_primary', kind: 'bool', editable: false },
  { key: 'checked_at', kind: 'timestamp', editable: false },
  { key: 'id', kind: 'text', editable: false },
];

/** Typed input → database value. Empty → null. Throws a readable message on bad input. */
export function parseField(field: Field, raw: string): string | number | null {
  const v = raw.trim();
  if (v === '') {
    if (field.key === 'name') throw new Error('Artist name cannot be empty');
    return null;
  }
  switch (field.kind) {
    case 'int': {
      const digits = v.replace(/[\s,._]/g, '');
      if (!/^\d+$/.test(digits)) throw new Error(`${field.key}: whole number expected, got "${v}"`);
      return Number(digits);
    }
    case 'select':
      if (!field.options!.includes(v)) throw new Error(`${field.key}: one of ${field.options!.join(', ')}`);
      return v;
    default:
      if (field.key === 'linkedin_url') return normalizeLinkedinUrl(v);
      if (field.key === 'email') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error(`email: "${v}" is not an email address`);
        return v.toLowerCase();
      }
      return v;
  }
}

/** Only the editable fields that changed, parsed. `before` is the row as loaded. */
export function changedValues(
  fields: Field[],
  before: Record<string, unknown>,
  input: Record<string, string>,
): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const f of fields) {
    if (!f.editable || !(f.key in input)) continue;
    const value = parseField(f, input[f.key]);
    const old = before[f.key] ?? null;
    if (value !== old) out[f.key] = value;
  }
  return out;
}
