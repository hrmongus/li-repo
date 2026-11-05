'use server';

import { revalidatePath } from 'next/cache';
import { csvToLeads, isReadyResearch, parseCsv, pastedUrlsToLeads, personKey, prepareLeads, type LeadInput } from '@/lib/leads';
import { createClient } from '@/lib/supabase/server';

export interface UploadResult {
  error?: string;
  added?: number;
  addedWithoutLinkedin?: number;
  alreadyThere?: number;
  duplicatesInFile?: number;
  noPerson?: number;
  /** Researcher CSV: how many of the added leads went straight to ready / disqualified. */
  ready?: number;
  disqualified?: number;
  /** Existing leads updated from a backlog export (or researched rows for known people). */
  updated?: number;
  /** Rows that couldn't be applied, e.g. their LinkedIn URL already belongs to another lead. */
  conflicts?: number;
}

/** The lead row as stored: everything except the artist, which goes to the artists table. */
const leadRow = ({ artist, lead_id, ...row }: LeadInput) => row; // eslint-disable-line @typescript-eslint/no-unused-vars

const BATCH = 500;
const IN_RESEARCH = ['new', 'artists_found', 'enriched'];

/** True when a researcher filled in research results on this row. */
const hasResearch = (l: LeadInput) =>
  !!l.research_status || !!l.artist || l.top_artist_listeners !== undefined || l.company_staff !== undefined || l.li_checked_at !== undefined;

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Researcher rows for leads already in the CRM (backlog export, or a person we already have):
 * update the lead if it is still in research. Ready and disqualified leads, and the outreach
 * status, are never touched. Only filled cells change anything; notes are appended.
 */
async function updateExisting(supabase: Supabase, rows: (LeadInput & { lead_id: string })[]) {
  const result = { updated: 0, ready: 0, disqualified: 0, notInResearch: 0, conflicts: 0 };
  const existing = new Map<string, Record<string, any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const ids = rows.map((r) => r.lead_id);
  for (let i = 0; i < ids.length; i += BATCH) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, research_status, linkedin_url, first_name, company_name, company_type, li_checked_at, notes')
      .in('id', ids.slice(i, i + BATCH));
    if (error) throw new Error(error.message);
    for (const l of data ?? []) existing.set(l.id, l);
  }

  for (const row of rows) {
    const old = existing.get(row.lead_id);
    if (!old || !IN_RESEARCH.includes(old.research_status)) {
      result.notInResearch++;
      continue;
    }
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(leadRow(row))) {
      if (k === 'notes' || k === 'last_li_activity') continue;
      if (v !== undefined && v !== null && v !== '') patch[k] = v;
    }
    if (row.li_checked_at !== undefined) patch.last_li_activity = row.last_li_activity ?? null;
    if (row.notes) patch.notes = [old.notes, row.notes].filter(Boolean).join('\n');

    const { error } = await supabase.from('leads').update(patch).eq('id', row.lead_id);
    if (error) {
      result.conflicts++; // e.g. the LinkedIn URL already belongs to another lead
      continue;
    }
    result.updated++;
    if (row.research_status === 'disqualified') {
      result.disqualified++;
      continue;
    }

    if (row.artist) {
      await supabase.from('artists').delete().eq('lead_id', row.lead_id);
      const { error: artistError } = await supabase
        .from('artists')
        .insert({ ...row.artist, lead_id: row.lead_id, is_primary: true, checked_at: new Date().toISOString() });
      if (artistError) continue;
    }
    const merged: LeadInput = {
      ...row,
      linkedin_url: row.linkedin_url ?? old.linkedin_url,
      first_name: row.first_name ?? old.first_name,
      company_name: row.company_name ?? old.company_name,
      company_type: row.company_type ?? old.company_type,
      li_checked_at: row.li_checked_at ?? old.li_checked_at ?? undefined,
    };
    if (isReadyResearch(merged)) {
      const { error: readyError } = await supabase.from('leads').update({ research_status: 'ready' }).eq('id', row.lead_id);
      if (!readyError) result.ready++;
    }
  }
  return result;
}

export async function uploadLeads(_prev: UploadResult | null, formData: FormData): Promise<UploadResult> {
  const leads: LeadInput[] = [];
  try {
    const file = formData.get('file');
    if (file instanceof File && file.size > 0) leads.push(...csvToLeads(parseCsv(await file.text())));
    leads.push(...pastedUrlsToLeads(String(formData.get('urls') ?? '')));
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (leads.length === 0) return { error: 'Nothing to upload: choose a CSV or paste LinkedIn URLs.' };

  const { valid, noPerson, duplicatesInFile } = prepareLeads(leads);
  // Rows from a backlog export carry lead_id: they update that lead instead of adding one.
  const byId = valid.filter((l): l is LeadInput & { lead_id: string } => !!l.lead_id);
  const fresh = valid.filter((l) => !l.lead_id);
  const withUrl = fresh.filter((l) => l.linkedin_url);
  let withoutUrl = fresh.filter((l) => !l.linkedin_url);

  const supabase = await createClient();

  // Leads without a LinkedIn URL: skip people already in the CRM (same name + company, or email).
  if (withoutUrl.length > 0) {
    const existing = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('leads')
        .select('full_name, company_name, email')
        .range(from, from + 999);
      if (error) return { error: error.message };
      for (const l of data ?? []) {
        const k = personKey(l);
        if (k) existing.add(k);
        if (l.email) existing.add(`email:${l.email.trim().toLowerCase()}`);
      }
      if (!data || data.length < 1000) break;
    }
    withoutUrl = withoutUrl.filter(
      (l) => !existing.has(personKey(l) ?? '') && !(l.email && existing.has(`email:${l.email.trim().toLowerCase()}`)),
    );
  }

  // Insert new leads. Existing people (same LinkedIn URL) are skipped, never overwritten.
  const inserted: { id: string; linkedin_url: string | null }[] = [];
  let added = 0;
  for (let i = 0; i < withUrl.length; i += BATCH) {
    const { data, error } = await supabase
      .from('leads')
      .upsert(withUrl.slice(i, i + BATCH).map(leadRow), { onConflict: 'linkedin_url', ignoreDuplicates: true })
      .select('id, linkedin_url');
    if (error) return { error: error.message, added };
    added += data?.length ?? 0;
    inserted.push(...(data ?? []));
  }
  let addedWithoutLinkedin = 0;
  for (let i = 0; i < withoutUrl.length; i += BATCH) {
    const { data, error } = await supabase.from('leads').insert(withoutUrl.slice(i, i + BATCH).map(leadRow)).select('id');
    if (error) return { error: error.message, added, addedWithoutLinkedin };
    addedWithoutLinkedin += data?.length ?? 0;
  }

  // Researcher CSV: primary artists for the new leads, then complete leads go to ready.
  // (A lead without a LinkedIn URL can't be ready, so only the URL rows matter here.)
  const byUrl = new Map(withUrl.map((l) => [l.linkedin_url, l]));
  const artists = inserted.flatMap(({ id, linkedin_url }) => {
    const a = byUrl.get(linkedin_url)?.artist;
    return a ? [{ ...a, lead_id: id, is_primary: true, checked_at: new Date().toISOString() }] : [];
  });
  for (let i = 0; i < artists.length; i += BATCH) {
    const { error } = await supabase.from('artists').insert(artists.slice(i, i + BATCH));
    if (error) return { error: `Leads added, but artists failed: ${error.message}`, added };
  }
  const readyIds = inserted.filter(({ linkedin_url }) => isReadyResearch(byUrl.get(linkedin_url)!)).map((r) => r.id);
  for (let i = 0; i < readyIds.length; i += BATCH) {
    const { error } = await supabase.from('leads').update({ research_status: 'ready' }).in('id', readyIds.slice(i, i + BATCH));
    if (error) return { error: `Leads added, but marking them ready failed: ${error.message}`, added };
  }
  const disqualified = inserted.filter(({ linkedin_url }) => byUrl.get(linkedin_url)?.research_status === 'disqualified').length
    + withoutUrl.filter((l) => l.research_status === 'disqualified').length;

  // Researched rows for people already in the CRM (same LinkedIn URL): update them like backlog rows.
  const insertedUrls = new Set(inserted.map((r) => r.linkedin_url));
  const researchedExisting = withUrl.filter((l) => !insertedUrls.has(l.linkedin_url) && hasResearch(l));
  const updates = [...byId];
  for (let i = 0; i < researchedExisting.length; i += BATCH) {
    const chunk = researchedExisting.slice(i, i + BATCH);
    const { data, error } = await supabase.from('leads').select('id, linkedin_url').in('linkedin_url', chunk.map((l) => l.linkedin_url!));
    if (error) return { error: error.message, added };
    const idByUrl = new Map((data ?? []).map((r) => [r.linkedin_url, r.id]));
    for (const l of chunk) {
      const id = idByUrl.get(l.linkedin_url);
      if (id) updates.push({ ...l, lead_id: id });
    }
  }
  let upd = { updated: 0, ready: 0, disqualified: 0, notInResearch: 0, conflicts: 0 };
  try {
    if (updates.length) upd = await updateExisting(supabase, updates);
  } catch (e) {
    return { error: `New leads added, but updating existing ones failed: ${(e as Error).message}`, added };
  }

  revalidatePath('/queue');
  revalidatePath('/dashboard');
  return {
    added: added + addedWithoutLinkedin,
    addedWithoutLinkedin,
    alreadyThere: Math.max(0, fresh.length - added - addedWithoutLinkedin - researchedExisting.length),
    duplicatesInFile,
    noPerson,
    ready: readyIds.length + upd.ready,
    disqualified: disqualified + upd.disqualified,
    updated: upd.updated,
    conflicts: upd.conflicts,
  };
}
