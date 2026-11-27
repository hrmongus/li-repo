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

// ---------- Apps vertical: founder CSV ----------

export interface AppInput {
  app_name: string;
  app_store_url?: string;
  rating_count?: number;
  avg_rating?: number;
  genre?: string;
  release_date?: string;
  tiktok_handle?: string;
  yc_batch?: string;
  source?: string;
}

/** One founder (lead) from an apps CSV. company_name = the app's name (one company per app). */
export interface AppLeadInput {
  linkedin_url: string | null;
  full_name?: string;
  first_name?: string;
  title?: string;
  company_name?: string;
  company_website?: string;
  x_url?: string;
  instagram_url?: string;
  crunchbase_url?: string;
  email?: string;
  email_source?: string;
  email_type?: string;
  email_alt?: string;
  notes?: string;
  app?: AppInput;
}

/** The apps CSV columns, exactly as the founder research files name them. */
export const APP_CSV_COLUMNS = [
  'founder_name', 'founder_title', 'linkedin_url', 'x_url', 'instagram_url', 'email', 'email_source',
  'email_type', 'email_alt', 'app_name', 'app_store_url', 'rating_count', 'avg_rating', 'genre',
  'release_date', 'website', 'crunchbase_url', 'tiktok_handle_found', 'yc_batch', 'source',
] as const;
type AppColumn = (typeof APP_CSV_COLUMNS)[number];

/** Max founders per company (app) in the CRM. */
export const MAX_FOUNDERS_PER_APP = 2;

/** "x.com/jane", "twitter.com/jane?s=1", "@jane" -> "https://x.com/jane". Anything else: trimmed. */
export function normalizeXUrl(raw: string): string {
  const v = raw.trim();
  const handle = v.match(/^@?([A-Za-z0-9_]{1,15})$/);
  if (handle) return `https://x.com/${handle[1].toLowerCase()}`;
  const m = v.match(/^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})(?:[/?#].*)?$/i);
  return m ? `https://x.com/${m[1].toLowerCase()}` : v;
}

/** Store URL as given, minus query, fragment and trailing slash (Apple's ?l=, ?platform=…). */
export function cleanAppStoreUrl(raw: string): string {
  const v = raw.trim();
  // Google Play keeps its ?id=… (that's the app); everything else loses the query.
  if (/play\.google\.com/i.test(v)) {
    const id = v.match(/[?&]id=([\w.]+)/)?.[1];
    return id ? `https://play.google.com/store/apps/details?id=${id}` : v;
  }
  return v.replace(/[?#].*$/, '').replace(/\/+$/, '');
}

/**
 * Dedupe key for an app: the App Store id (same app across country paths), the Play package, or
 * the cleaned URL; without a URL, the app name. null = nothing to group on.
 */
export function appKey(app: { app_store_url?: string | null; app_name?: string | null } | undefined): string | null {
  const url = (app?.app_store_url ?? '').trim();
  if (url) {
    const apple = url.match(/apps\.apple\.com\/.*\/id(\d+)/i) ?? url.match(/itunes\.apple\.com\/.*\/id(\d+)/i);
    if (apple) return `apple:${apple[1]}`;
    const play = url.match(/play\.google\.com\/.*[?&]id=([\w.]+)/i);
    if (play) return `play:${play[1].toLowerCase()}`;
    return `url:${cleanAppStoreUrl(url).toLowerCase()}`;
  }
  const name = (app?.app_name ?? '').trim().toLowerCase();
  return name ? `name:${name}` : null;
}

/** Person key for a founder: LinkedIn, else X, else email. null = no contact at all. */
export function founderKey(l: { linkedin_url?: string | null; x_url?: string | null; email?: string | null }): string | null {
  if (l.linkedin_url) return `li:${l.linkedin_url}`;
  if (l.x_url) return `x:${l.x_url.toLowerCase()}`;
  if (l.email) return `email:${l.email.trim().toLowerCase()}`;
  return null;
}

/** Apps ready rule (the database checks it too): founder name + at least one of LinkedIn, email, X. */
export function isReadyApp(l: Pick<AppLeadInput, 'first_name' | 'linkedin_url' | 'email' | 'x_url'>): boolean {
  return !!l.first_name && (!!l.linkedin_url || !!l.email || !!l.x_url);
}

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/**
 * Map an apps CSV to founder leads. First row = header (column names in APP_CSV_COLUMNS; case,
 * spaces and dashes ignored). Bad numbers, dates and emails become notes, never fail the upload.
 * Unknown columns go to notes as "Header: value".
 */
export function csvToAppLeads(rows: string[][]): AppLeadInput[] {
  const [header, ...data] = rows;
  if (!header) return [];
  const index: Partial<Record<AppColumn, number>> = {};
  for (const col of APP_CSV_COLUMNS) {
    const i = header.findIndex((h) => clean(h) === clean(col));
    if (i >= 0) index[col] = i;
  }
  if (index.founder_name === undefined) throw new Error('Apps CSV needs a founder_name column.');
  if (index.linkedin_url === undefined && index.email === undefined && index.x_url === undefined) {
    throw new Error('Apps CSV needs at least one contact column: linkedin_url, email or x_url.');
  }
  const used = new Set(Object.values(index));
  const extra = header.map((h, i) => ({ h: h.trim(), i })).filter(({ i }) => !used.has(i));

  return data.map((r) => {
    const get = (c: AppColumn) => {
      const i = index[c];
      return i === undefined ? '' : (r[i] ?? '').trim();
    };
    const problems: string[] = [];
    const lead: AppLeadInput = { linkedin_url: get('linkedin_url') || null };

    const name = get('founder_name');
    if (name) {
      lead.full_name = name;
      const n = name.includes(',') ? name.split(',')[1] : name;
      lead.first_name = n.trim().split(/\s+/)[0] || undefined;
    }
    if (get('founder_title')) lead.title = get('founder_title');
    if (get('x_url')) lead.x_url = normalizeXUrl(get('x_url'));
    if (get('instagram_url')) lead.instagram_url = get('instagram_url');
    if (get('crunchbase_url')) lead.crunchbase_url = get('crunchbase_url');
    if (get('website')) lead.company_website = get('website');
    for (const c of ['email', 'email_alt'] as const) {
      const v = get(c).toLowerCase();
      if (!v) continue;
      if (isEmail(v)) lead[c] = v;
      else problems.push(`${c} not an email address: ${v}`);
    }
    if (get('email_source')) lead.email_source = get('email_source');
    if (get('email_type')) lead.email_type = get('email_type');

    const appName = get('app_name');
    if (appName) {
      lead.company_name = appName;
      const num = (c: AppColumn) => {
        const v = get(c);
        if (!v) return undefined;
        const n = toInt(v);
        if (n === undefined) problems.push(`${c} not a plain number: ${v}`);
        return n;
      };
      const rating = get('avg_rating');
      let avg: number | undefined;
      if (rating) {
        const n = Number(rating.replace(',', '.'));
        if (Number.isFinite(n) && n >= 0 && n <= 5) avg = n;
        else problems.push(`avg_rating not a rating 0-5: ${rating}`);
      }
      const released = get('release_date');
      if (released && !isDate(released)) problems.push(`release_date not YYYY-MM-DD: ${released}`);
      lead.app = {
        app_name: appName,
        app_store_url: get('app_store_url') ? cleanAppStoreUrl(get('app_store_url')) : undefined,
        rating_count: num('rating_count'),
        avg_rating: avg,
        genre: get('genre') || undefined,
        release_date: released && isDate(released) ? released : undefined,
        tiktok_handle: get('tiktok_handle_found') || undefined,
        yc_batch: get('yc_batch') || undefined,
        source: get('source') || undefined,
      };
    }

    const notes = extra
      .map(({ h, i }) => [h, (r[i] ?? '').trim()] as const)
      .filter(([, v]) => v !== '')
      .map(([h, v]) => `${h}: ${v}`);
    if (problems.length) notes.push(`Upload check: ${problems.join('; ')}`);
    if (notes.length) lead.notes = notes.join('\n');
    return lead;
  });
}

/**
 * Normalize and dedupe one apps upload:
 * - LinkedIn URLs that aren't profiles move to notes;
 * - rows without a founder name or without any contact (LinkedIn, email, X) are skipped;
 * - the same founder twice in the file (same LinkedIn / X / email) is kept once.
 */
export function prepareAppLeads(leads: AppLeadInput[]) {
  const seen = new Set<string>();
  const valid: AppLeadInput[] = [];
  let noFounder = 0;
  let duplicatesInFile = 0;
  for (const raw of leads) {
    const lead = { ...raw };
    if (lead.linkedin_url && isLinkedinProfileUrl(lead.linkedin_url)) {
      lead.linkedin_url = normalizeLinkedinUrl(lead.linkedin_url);
    } else {
      if (lead.linkedin_url) lead.notes = [lead.notes, `LinkedIn (not a profile): ${lead.linkedin_url}`].filter(Boolean).join('\n');
      lead.linkedin_url = null;
    }
    const keys = [
      lead.linkedin_url && `li:${lead.linkedin_url}`,
      lead.x_url && `x:${lead.x_url.toLowerCase()}`,
      lead.email && `email:${lead.email}`,
    ].filter((k): k is string => !!k);
    if (!lead.first_name || keys.length === 0) {
      noFounder++;
      continue;
    }
    if (keys.some((k) => seen.has(k))) {
      duplicatesInFile++;
      continue;
    }
    keys.forEach((k) => seen.add(k));
    valid.push(lead);
  }
  return { valid, noFounder, duplicatesInFile };
}

/**
 * Max MAX_FOUNDERS_PER_APP founders per app (deduped on app_store_url, see appKey), counting the
 * founders already in the CRM. Founders already in the CRM (updates) always pass; new ones only
 * while the app has a free slot. Rows keep their file order.
 */
export function capFounders<T extends AppLeadInput>(
  rows: T[],
  existingPerApp: Map<string, number>,
  isExisting: (row: T) => boolean,
): { kept: T[]; overCap: number } {
  const taken = new Map(existingPerApp);
  const kept: T[] = [];
  let overCap = 0;
  for (const row of rows) {
    const key = appKey(row.app);
    if (isExisting(row) || !key) {
      kept.push(row);
      continue;
    }
    const n = taken.get(key) ?? 0;
    if (n >= MAX_FOUNDERS_PER_APP) {
      overCap++;
      continue;
    }
    taken.set(key, n + 1);
    kept.push(row);
  }
  return { kept, overCap };
}
