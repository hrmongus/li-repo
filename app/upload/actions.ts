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
}

/** The lead row as stored: everything except the artist, which goes to the artists table. */
const leadRow = ({ artist, ...row }: LeadInput) => row; // eslint-disable-line @typescript-eslint/no-unused-vars

const BATCH = 500;

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
  const withUrl = valid.filter((l) => l.linkedin_url);
  let withoutUrl = valid.filter((l) => !l.linkedin_url);

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

  revalidatePath('/queue');
  revalidatePath('/dashboard');
  return {
    added: added + addedWithoutLinkedin,
    addedWithoutLinkedin,
    alreadyThere: valid.length - added - addedWithoutLinkedin,
    duplicatesInFile,
    noPerson,
    ready: readyIds.length,
    disqualified,
  };
}
