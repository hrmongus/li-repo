// Upload helpers: CSV parsing, column matching and LinkedIn URL normalization.
// The database normalizes linkedin_url too (normalize_linkedin_url); this copy is only used to
// dedupe within one upload and to count duplicates. Keep the two in sync.

export function normalizeLinkedinUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/[?#].*$/, '')
    .replace(/^(https?:\/\/)?([a-z]{2,3}\.)?(www\.)?linkedin\.com/, 'https://www.linkedin.com')
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

export interface LeadInput {
  linkedin_url: string;
  full_name?: string;
  first_name?: string;
  title?: string;
  company_name?: string;
  company_type?: 'label' | 'management' | 'other';
  company_website?: string;
  email?: string;
  country?: string;
}

// Accepted header names (lowercased, spaces/underscores/dashes removed) per column.
const HEADERS: Record<keyof LeadInput, string[]> = {
  linkedin_url: ['linkedinurl', 'linkedin', 'profileurl', 'linkedinprofile', 'url'],
  full_name: ['fullname', 'name'],
  first_name: ['firstname'],
  title: ['title', 'jobtitle', 'position'],
  company_name: ['companyname', 'company'],
  company_type: ['companytype'],
  company_website: ['companywebsite', 'website'],
  email: ['email', 'emailaddress'],
  country: ['country'],
};

const clean = (h: string) => h.toLowerCase().replace(/[\s_-]/g, '');

/** Map CSV rows to leads. First row = header. Throws if no LinkedIn URL column is found. */
export function csvToLeads(rows: string[][]): LeadInput[] {
  const [header, ...data] = rows;
  if (!header) return [];
  const index: Partial<Record<keyof LeadInput, number>> = {};
  for (const [col, names] of Object.entries(HEADERS) as [keyof LeadInput, string[]][]) {
    const i = header.findIndex((h) => names.includes(clean(h)));
    if (i >= 0) index[col] = i;
  }
  if (index.linkedin_url === undefined) {
    throw new Error('No LinkedIn URL column found. Name it "linkedin_url" (or "LinkedIn", "profile url", "url").');
  }
  return data.map((r) => {
    const lead: LeadInput = { linkedin_url: '' };
    for (const [col, i] of Object.entries(index) as [keyof LeadInput, number][]) {
      const value = (r[i] ?? '').trim();
      if (!value) continue;
      if (col === 'company_type') {
        const t = value.toLowerCase();
        lead.company_type = t.startsWith('label') ? 'label' : t.startsWith('manage') ? 'management' : 'other';
      } else lead[col] = value;
    }
    if (!lead.first_name && lead.full_name) {
      // "Jane Doe" -> Jane, "Doe, Jane" -> Jane. Research can correct it before the lead is ready.
      const n = lead.full_name.includes(',') ? lead.full_name.split(',')[1] : lead.full_name;
      lead.first_name = n.trim().split(/\s+/)[0] || undefined;
    }
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

/** Keep valid profile URLs, normalized and deduped within the upload. */
export function prepareLeads(leads: LeadInput[]) {
  const seen = new Set<string>();
  const valid: LeadInput[] = [];
  let invalid = 0;
  let duplicatesInFile = 0;
  for (const lead of leads) {
    if (!lead.linkedin_url || !isLinkedinProfileUrl(lead.linkedin_url)) {
      invalid++;
      continue;
    }
    const url = normalizeLinkedinUrl(lead.linkedin_url);
    if (seen.has(url)) {
      duplicatesInFile++;
      continue;
    }
    seen.add(url);
    valid.push({ ...lead, linkedin_url: url });
  }
  return { valid, invalid, duplicatesInFile };
}
