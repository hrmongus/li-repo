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

export interface LeadInput {
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
}

type Column = Exclude<keyof LeadInput, 'notes'>;

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

const clean = (h: string) => h.toLowerCase().replace(/[\s_/-]/g, '');

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
  const used = new Set(Object.values(index));
  const extra = header.map((h, i) => ({ h: h.trim(), i })).filter(({ i }) => !used.has(i));

  return data.map((r) => {
    const lead: LeadInput = { linkedin_url: null };
    for (const [col, i] of Object.entries(index) as [Column, number][]) {
      const value = (r[i] ?? '').trim();
      if (!value) continue;
      if (col === 'company_type') lead.company_type = toCompanyType(value);
      else lead[col] = value;
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
