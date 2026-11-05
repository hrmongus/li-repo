// Upload helpers: CSV parsing, column matching and LinkedIn URL normalization.
// The database normalizes linkedin_url too (normalize_linkedin_url); this copy is only used to
// dedupe within one upload and to count duplicates. Keep the two in sync.

export function normalizeLinkedinUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/[?#].*$/, '')
    .replace(/^(https?:\/\/)?([a-z]{2,3}\.)?(www\.)?linkedin\.com/, 'https://www.linkedin.com')
    .replace(/^(https:\/\/www\.linkedin\.com\/in\/[^/]+)\/.*$/, '$1') // drop /en, /details/... after the slug
    .replace(/\/+$/, '');
}

export function isLinkedinProfileUrl(url: string): boolean {
  return /^https:\/\/www\.linkedin\.com\/in\/[^/\s]+$/.test(normalizeLinkedinUrl(url));
}

/** Minimal RFC 4180 CSV parser: quoted fields, "" escapes, commas/newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');
  // Use ';' if the header has more semicolons than commas (European Excel exports).
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === sep) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export type CompanyType = 'label' | 'management' | 'agency' | 'distributor' | 'other';

export interface ArtistInput {
  name: string;
  spotify_url?: string;
  monthly_listeners?: number;
  latest_release_title?: string;
  genre?: string;
  top_cities?: string;
  instagram_url?: string;
  instagram_followers?: number;
  tiktok_url?: string;
  tiktok_followers?: number;
  notes?: string;
}

export interface LeadInput {
  /** Set when the row came from a backlog export: the upload updates that lead. */
  lead_id?: string;
  linkedin_url: string | null;
  full_name?: string;
  first_name?: string;
  title?: string;
  company_name?: string;
  company_type?: CompanyType;
  company_website?: string;
  company_socials?: string;
  email?: string;
  country?: string;
  notes?: string;
  // Research results (researcher CSV, see the research guide). Not set by plain imports.
  research_status?: 'disqualified';
  disqualify_reason?: string;
  top_artist_listeners?: number;
  company_staff?: number;
  last_li_activity?: string | null;
  li_checked_at?: string;
  /** Primary artist; stored in the artists table, not on the lead. */
  artist?: ArtistInput;
}

type Column = 'linkedin_url' | 'full_name' | 'first_name' | 'title' | 'company_name' | 'company_type'
  | 'company_website' | 'company_socials' | 'email' | 'country';

// Accepted header names (lowercased, spaces/underscores/dashes/slashes removed) per column.
const HEADERS: Record<Column, string[]> = {
  linkedin_url: ['linkedinurl', 'linkedin', 'profileurl', 'linkedinprofile', 'url'],
  full_name: ['fullname', 'name'],
  first_name: ['firstname'],
  title: ['title', 'jobtitle', 'position'],
  company_name: ['companyname', 'company'],
  company_type: ['companytype', 'segment', 'type'],
  company_website: ['companywebsite', 'website'],
  company_socials: ['companysocials', 'companylinkedin', 'socials'],
  email: ['email', 'emailaddress'],
  country: ['country'],
};

/** The researcher CSV header, in order (the research guide and leads_template.csv). */
export const RESEARCH_CSV_HEADER = [
  'linkedin_url', 'full_name', 'first_name', 'title', 'company_name', 'company_type', 'company_website',
  'company_linkedin', 'email', 'country', 'disqualify_reason', 'top_artist_listeners', 'company_staff',
  'last_li_activity', 'artist_name', 'artist_spotify_url', 'artist_monthly_listeners', 'artist_latest_song',
  'artist_genre', 'artist_top_cities', 'artist_instagram_url', 'artist_instagram_followers', 'artist_tiktok_url',
  'artist_tiktok_followers', 'artist_source_url', 'researcher', 'research_date', 'notes',
];

/** One CSV line: quotes around cells with a comma, quote or line break. */
export function toCsvLine(cells: (string | number | null | undefined)[]): string {
  return cells
    .map((c) => {
      const s = c == null ? '' : String(c);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(',');
}

// Research columns from the researcher CSV (exact names from the research guide).
const RESEARCH_COLUMNS = [
  'disqualify_reason', 'top_artist_listeners', 'company_staff', 'last_li_activity',
  'artist_name', 'artist_spotify_url', 'artist_monthly_listeners', 'artist_latest_song', 'artist_genre',
  'artist_top_cities', 'artist_instagram_url', 'artist_instagram_followers', 'artist_tiktok_url',
  'artist_tiktok_followers', 'artist_source_url', 'research_date',
] as const;
type ResearchColumn = (typeof RESEARCH_COLUMNS)[number];

export const DISQUALIFY_REASONS = ['major', 'roster_too_big', 'roster_too_small', 'company_too_big', 'distributor', 'competitor'];

const clean = (h: string) => h.toLowerCase().replace(/[\s_/-]/g, '');

/** "250000" / "250,000" / "250 000" -> 250000; anything else (e.g. "250k") -> undefined. */
function toInt(value: string): number | undefined {
  const digits = value.replace(/[\s,.]/g, '');
  return /^\d+$/.test(digits) ? Number(digits) : undefined;
}

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/**
 * Apply the research columns of one row to a lead. Problems (bad numbers, unknown reason) become
 * notes instead of failing the upload.
 */
function applyResearch(lead: LeadInput, get: (c: ResearchColumn) => string, problems: string[]) {
  const num = (c: ResearchColumn) => {
    const v = get(c);
    if (!v) return undefined;
    const n = toInt(v);
    if (n === undefined) problems.push(`${c} not a plain number: ${v}`);
    return n;
  };

  const reason = get('disqualify_reason').toLowerCase();
  if (reason && DISQUALIFY_REASONS.includes(reason)) {
    lead.research_status = 'disqualified';
    lead.disqualify_reason = reason;
  } else if (reason) {
    problems.push(`unknown disqualify_reason: ${reason}`);
  }
  // Rule: every distributor is disqualified.
  if (lead.company_type === 'distributor' && !lead.disqualify_reason) {
    lead.research_status = 'disqualified';
    lead.disqualify_reason = 'distributor';
  }

  lead.top_artist_listeners = num('top_artist_listeners');
  lead.company_staff = num('company_staff');

  const researchDate = get('research_date');
  const activity = get('last_li_activity').toLowerCase();
  if (activity === 'never') {
    lead.last_li_activity = null;
    lead.li_checked_at = isDate(researchDate) ? researchDate : new Date().toISOString().slice(0, 10);
  } else if (activity && isDate(activity)) {
    lead.last_li_activity = activity;
    lead.li_checked_at = isDate(researchDate) ? researchDate : new Date().toISOString().slice(0, 10);
  } else if (activity) {
    problems.push(`last_li_activity not a date or "never": ${activity}`);
  }

  // Never research artists for agencies: artist columns on an agency row are ignored.
  const artistName = get('artist_name');
  if (artistName && lead.company_type !== 'agency') {
    lead.artist = {
      name: artistName,
      spotify_url: get('artist_spotify_url') || undefined,
      monthly_listeners: num('artist_monthly_listeners'),
      latest_release_title: get('artist_latest_song') || undefined,
      genre: get('artist_genre') || undefined,
      top_cities: get('artist_top_cities') || undefined,
      instagram_url: get('artist_instagram_url') || undefined,
      instagram_followers: num('artist_instagram_followers'),
      tiktok_url: get('artist_tiktok_url') || undefined,
      tiktok_followers: num('artist_tiktok_followers'),
      notes: get('artist_source_url') ? `Source: ${get('artist_source_url')}` : undefined,
    };
  }
}

/**
 * Ready = everything the database's ready gate checks: LinkedIn URL, first name, company, a
 * message type, and for labels/management a primary artist with name, song and listeners.
 * LinkedIn activity isn't needed: a VA checks it in the CRM (the li_check step).
 */
export function isReadyResearch(l: LeadInput): boolean {
  if (l.research_status === 'disqualified') return false;
  if (!l.linkedin_url || !l.first_name || !l.company_name) return false;
  if (l.company_type === 'agency') return true;
  if (l.company_type !== 'label' && l.company_type !== 'management') return false;
  const a = l.artist;
  return !!a && !!a.name && !!a.latest_release_title && a.monthly_listeners !== undefined;
}

/** "A · Indie label" -> label, "B · Artist manager" -> management, "C · Agency" -> agency, ... */
export function toCompanyType(value: string): CompanyType {
  const t = value.toLowerCase();
  // Agency and distributor first: "C · Agency (white-label)" also contains "label".
  if (t.includes('agency')) return 'agency';
  if (t.includes('distribut')) return 'distributor';
  if (t.includes('label')) return 'label';
  if (t.includes('manage')) return 'management';
  return 'other';
}

/**
 * Map CSV rows to leads. First row = header. Known columns go to their fields; every other
 * non-empty column is kept as a "Header: value" line in notes.
 */
export function csvToLeads(rows: string[][]): LeadInput[] {
  const [header, ...data] = rows;
  if (!header) return [];
  const index: Partial<Record<Column, number>> = {};
  for (const [col, names] of Object.entries(HEADERS) as [Column, string[]][]) {
    const i = header.findIndex((h) => names.includes(clean(h)));
    if (i >= 0) index[col] = i;
  }
  if (index.linkedin_url === undefined && index.full_name === undefined && index.first_name === undefined) {
    throw new Error('Need a LinkedIn URL column (linkedin_url, LinkedIn, profile url, url) or a name column.');
  }
  const researchIndex: Partial<Record<ResearchColumn, number>> = {};
  for (const col of RESEARCH_COLUMNS) {
    const i = header.findIndex((h) => clean(h) === clean(col));
    if (i >= 0) researchIndex[col] = i;
  }
  const isResearchFile = Object.keys(researchIndex).length > 0;
  const idIndex = header.findIndex((h) => clean(h) === 'leadid');
  // crm_notes = the CRM's own notes, exported as hints for the researcher; never imported back.
  const crmNotesIndex = header.findIndex((h) => clean(h) === 'crmnotes');
  const used = new Set([...Object.values(index), ...Object.values(researchIndex), idIndex, crmNotesIndex]);
  const extra = header.map((h, i) => ({ h: h.trim(), i })).filter(({ i }) => !used.has(i));

  return data.map((r) => {
    const lead: LeadInput = { linkedin_url: null };
    const leadId = idIndex >= 0 ? (r[idIndex] ?? '').trim() : '';
    if (/^[0-9a-f-]{36}$/i.test(leadId)) lead.lead_id = leadId;
    for (const [col, i] of Object.entries(index) as [Column, number][]) {
      const value = (r[i] ?? '').trim();
      if (!value) continue;
      if (col === 'company_type') lead.company_type = toCompanyType(value);
      else lead[col] = value;
    }
    const problems: string[] = [];
    if (isResearchFile) {
      applyResearch(lead, (c) => {
        const i = researchIndex[c];
        return i === undefined ? '' : (r[i] ?? '').trim();
      }, problems);
    }
    if (!lead.first_name && lead.full_name) {
      // "Jane Doe" -> Jane, "Doe, Jane" -> Jane. Research can correct it before the lead is ready.
      const n = lead.full_name.includes(',') ? lead.full_name.split(',')[1] : lead.full_name;
      lead.first_name = n.trim().split(/\s+/)[0] || undefined;
    }
    if (!lead.full_name && lead.first_name) lead.full_name = lead.first_name;
    const notes = extra
      .map(({ h, i }) => [h, (r[i] ?? '').trim()] as const)
      .filter(([, v]) => v !== '')
      .map(([h, v]) => `${h}: ${v}`);
    if (problems.length) notes.push(`Upload check: ${problems.join('; ')}`);
    if (notes.length) lead.notes = notes.join('\n');
    return lead;
  });
}

/** One LinkedIn URL per line (or separated by spaces/commas). */
export function pastedUrlsToLeads(text: string): LeadInput[] {
  return text
    .split(/[\s,;]+/)
    .filter((s) => s.includes('linkedin.com'))
    .map((linkedin_url) => ({ linkedin_url }));
}

/** Dedupe key for a lead without a LinkedIn URL: name + company, else email. */
export function personKey(l: { full_name?: string | null; company_name?: string | null; email?: string | null }): string | null {
  const name = (l.full_name ?? '').trim().toLowerCase();
  if (name) return `name:${name}|${(l.company_name ?? '').trim().toLowerCase()}`;
  const email = (l.email ?? '').trim().toLowerCase();
  return email ? `email:${email}` : null;
}

/**
 * Normalize and dedupe one upload.
 * - A valid LinkedIn profile URL is the dedupe key.
 * - Without one (or with a non-profile URL, which moves into notes), the lead needs a person's
 *   name; it is deduped on name + company.
 * - Rows with neither a profile URL nor a name (shared mailboxes) are skipped.
 */
export function prepareLeads(leads: LeadInput[]) {
  const seen = new Set<string>();
  const valid: LeadInput[] = [];
  let noPerson = 0;
  let duplicatesInFile = 0;
  // Rows with a LinkedIn URL first, so a person who appears both with and without one keeps the URL.
  const ordered = [...leads].sort((a, b) => Number(!a.linkedin_url) - Number(!b.linkedin_url));
  for (const raw of ordered) {
    const lead = { ...raw };
    if (lead.linkedin_url && isLinkedinProfileUrl(lead.linkedin_url)) {
      lead.linkedin_url = normalizeLinkedinUrl(lead.linkedin_url);
    } else {
      if (lead.linkedin_url) lead.notes = [lead.notes, `LinkedIn (not a profile): ${lead.linkedin_url}`].filter(Boolean).join('\n');
      lead.linkedin_url = null;
    }
    const key = lead.linkedin_url ?? (lead.first_name ? personKey(lead) : null);
    if (!key) {
      noPerson++;
      continue;
    }
    if (seen.has(key)) {
      duplicatesInFile++;
      continue;
    }
    seen.add(key);
    const pk = personKey(lead);
    if (lead.linkedin_url && pk) seen.add(pk);
    valid.push(lead);
  }
  return { valid, noPerson, duplicatesInFile };
}
