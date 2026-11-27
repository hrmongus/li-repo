'use server';

import { revalidatePath } from 'next/cache';
import {
  appKey,
  capFounders,
  csvToAppLeads,
  founderKey,
  isReadyApp,
  parseCsv,
  prepareAppLeads,
  type AppLeadInput,
} from '@/lib/leads';
import { createClient } from '@/lib/supabase/server';

export interface AppUploadResult {
  error?: string;
  added?: number;
  updated?: number;
  /** Of the added and updated founders: how many are ready for outreach. */
  ready?: number;
  duplicatesInFile?: number;
  /** Rows without a founder name or without any contact (LinkedIn, email, X). */
  noFounder?: number;
  /** New founders skipped because their app already has 2 founders. */
  overCap?: number;
  /** LinkedIn URL already belongs to a music lead, or the database refused the row. */
  conflicts?: number;
}

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Supabase = Awaited<ReturnType<typeof createClient>>;

const BATCH = 500;
const IN_BATCH = 50; // .in(...) lists go into the URL; keep them short
const IN_RESEARCH = ['new', 'artists_found', 'enriched'];
const CONTACT_FIELDS = [
  'full_name', 'first_name', 'title', 'company_name', 'company_website', 'linkedin_url', 'x_url',
  'instagram_url', 'crunchbase_url', 'email', 'email_source', 'email_type', 'email_alt',
] as const;

async function readAll(build: (from: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>) {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

/** The lead row for a new founder. */
function newLeadRow(l: AppLeadInput) {
  const row: Record<string, unknown> = {
    vertical: 'apps',
    company_type: 'app',
    research_status: isReadyApp(l) ? 'ready' : 'enriched',
  };
  for (const k of CONTACT_FIELDS) if (l[k]) row[k] = l[k];
  if (l.notes) row.notes = l.notes;
  return row;
}

const appRow = (leadId: string, l: AppLeadInput) => ({ ...l.app!, lead_id: leadId, is_primary: true });

/** Replace a lead's primary app. */
async function replacePrimaryApp(supabase: Supabase, leadId: string, l: AppLeadInput) {
  const { error: delError } = await supabase.from('apps').delete().eq('lead_id', leadId).eq('is_primary', true);
  if (delError) return delError.message;
  const { error } = await supabase.from('apps').insert(appRow(leadId, l));
  return error?.message ?? null;
}

/**
 * Apps CSV upload: upsert founders (leads, vertical 'apps', company_type 'app') matched on LinkedIn
 * URL (else X, else email), and their app as the primary apps row. Max 2 founders per app, deduped
 * on app_store_url. A new founder is ready when they have a name and a contact (LinkedIn, email or
 * X), otherwise enriched. Existing founders: filled cells update the lead and the app is replaced;
 * their outreach status is never touched (a lead still in research is promoted to ready when complete).
 */
export async function uploadAppLeads(_prev: AppUploadResult | null, formData: FormData): Promise<AppUploadResult> {
  let parsed: AppLeadInput[];
  try {
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { error: 'Choose an apps CSV first.' };
    parsed = csvToAppLeads(parseCsv(await file.text()));
  } catch (e) {
    return { error: (e as Error).message };
  }
  const { valid, noFounder, duplicatesInFile } = prepareAppLeads(parsed);
  if (valid.length === 0) return { noFounder, duplicatesInFile, added: 0, updated: 0, ready: 0, overCap: 0, conflicts: 0 };

  const supabase = await createClient();
  try {
    // Existing apps founders, by every contact key; and the founders per app already in the CRM.
    const existingLeads = await readAll((from) =>
      supabase
        .from('leads')
        .select('id, linkedin_url, x_url, email, first_name, research_status, notes')
        .eq('vertical', 'apps')
        .range(from, from + 999),
    );
    const byKey = new Map<string, Row>();
    for (const l of existingLeads) {
      if (l.linkedin_url) byKey.set(`li:${l.linkedin_url}`, l);
      if (l.x_url) byKey.set(`x:${String(l.x_url).toLowerCase()}`, l);
      if (l.email) byKey.set(`email:${String(l.email).toLowerCase()}`, l);
    }
    const findExisting = (l: AppLeadInput): Row | undefined =>
      [l.linkedin_url && `li:${l.linkedin_url}`, l.x_url && `x:${l.x_url.toLowerCase()}`, l.email && `email:${l.email}`]
        .filter((k): k is string => !!k)
        .map((k) => byKey.get(k))
        .find(Boolean);

    const existingApps = await readAll((from) =>
      supabase.from('apps').select('lead_id, app_name, app_store_url').eq('is_primary', true).range(from, from + 999),
    );
    const foundersPerApp = new Map<string, Set<string>>();
    for (const a of existingApps) {
      const k = appKey(a);
      if (!k) continue;
      if (!foundersPerApp.has(k)) foundersPerApp.set(k, new Set());
      foundersPerApp.get(k)!.add(a.lead_id);
    }
    const existingCount = new Map([...foundersPerApp].map(([k, s]) => [k, s.size]));
    const { kept, overCap } = capFounders(valid, existingCount, (l) => !!findExisting(l));

    // LinkedIn URLs that already belong to a music lead: never turn a music lead into an app lead.
    const musicUrls = new Set<string>();
    const urls = kept.filter((l) => l.linkedin_url && !findExisting(l)).map((l) => l.linkedin_url!);
    for (let i = 0; i < urls.length; i += IN_BATCH) {
      const { data, error } = await supabase.from('leads').select('linkedin_url').eq('vertical', 'music').in('linkedin_url', urls.slice(i, i + IN_BATCH));
      if (error) throw new Error(error.message);
      for (const r of data ?? []) musicUrls.add(r.linkedin_url);
    }

    let conflicts = 0;
    let ready = 0;
    const fresh = kept.filter((l) => {
      if (findExisting(l)) return false;
      if (l.linkedin_url && musicUrls.has(l.linkedin_url)) {
        conflicts++;
        return false;
      }
      return true;
    });

    // New founders: insert leads, then their apps.
    let added = 0;
    for (let i = 0; i < fresh.length; i += BATCH) {
      const chunk = fresh.slice(i, i + BATCH);
      const { data, error } = await supabase.from('leads').insert(chunk.map(newLeadRow)).select('id, linkedin_url, x_url, email, research_status');
      if (error) throw new Error(`Adding founders failed: ${error.message}`);
      const idByKey = new Map((data ?? []).map((r) => [founderKey(r), r]));
      const apps = [];
      for (const l of chunk) {
        const row = idByKey.get(founderKey(l));
        if (!row) continue;
        added++;
        if (row.research_status === 'ready') ready++;
        if (l.app) apps.push(appRow(row.id, l));
      }
      if (apps.length) {
        const { error: appError } = await supabase.from('apps').insert(apps);
        if (appError) throw new Error(`Founders added, but saving their apps failed: ${appError.message}`);
      }
    }

    // Existing founders: filled cells only, notes appended, app replaced, status untouched.
    let updated = 0;
    for (const l of kept) {
      const old = findExisting(l);
      if (!old) continue;
      const patch: Record<string, unknown> = {};
      for (const k of CONTACT_FIELDS) if (l[k]) patch[k] = l[k];
      if (l.notes) patch.notes = [old.notes, l.notes].filter(Boolean).join('\n');
      const merged = {
        first_name: l.first_name ?? old.first_name,
        linkedin_url: l.linkedin_url ?? old.linkedin_url,
        email: l.email ?? old.email,
        x_url: l.x_url ?? old.x_url,
      };
      if (IN_RESEARCH.includes(old.research_status) && isReadyApp(merged)) patch.research_status = 'ready';
      const { error } = await supabase.from('leads').update(patch).eq('id', old.id);
      if (error) {
        conflicts++; // e.g. the LinkedIn URL already belongs to another lead
        continue;
      }
      if (l.app) {
        const appError = await replacePrimaryApp(supabase, old.id, l);
        if (appError) {
          conflicts++;
          continue;
        }
      }
      updated++;
      if (patch.research_status === 'ready' || old.research_status === 'ready') ready++;
    }

    revalidatePath('/queue');
    revalidatePath('/dashboard');
    return { added, updated, ready, duplicatesInFile, noFounder, overCap, conflicts };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
