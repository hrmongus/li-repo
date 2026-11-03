'use server';

import { revalidatePath } from 'next/cache';
import { csvToLeads, parseCsv, pastedUrlsToLeads, personKey, prepareLeads, type LeadInput } from '@/lib/leads';
import { createClient } from '@/lib/supabase/server';

export interface UploadResult {
  error?: string;
  added?: number;
  addedWithoutLinkedin?: number;
  alreadyThere?: number;
  duplicatesInFile?: number;
  noPerson?: number;
}

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

  let added = 0;
  for (let i = 0; i < withUrl.length; i += BATCH) {
    const { data, error } = await supabase
      .from('leads')
      .upsert(withUrl.slice(i, i + BATCH), { onConflict: 'linkedin_url', ignoreDuplicates: true })
      .select('id');
    if (error) return { error: error.message, added };
    added += data?.length ?? 0;
  }
  let addedWithoutLinkedin = 0;
  for (let i = 0; i < withoutUrl.length; i += BATCH) {
    const { data, error } = await supabase.from('leads').insert(withoutUrl.slice(i, i + BATCH)).select('id');
    if (error) return { error: error.message, added, addedWithoutLinkedin };
    addedWithoutLinkedin += data?.length ?? 0;
  }

  revalidatePath('/queue');
  revalidatePath('/dashboard');
  return {
    added: added + addedWithoutLinkedin,
    addedWithoutLinkedin,
    alreadyThere: valid.length - added - addedWithoutLinkedin,
    duplicatesInFile,
    noPerson,
  };
}
