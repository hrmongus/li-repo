'use server';

import { revalidatePath } from 'next/cache';
import { csvToLeads, parseCsv, pastedUrlsToLeads, prepareLeads, type LeadInput } from '@/lib/leads';
import { createClient } from '@/lib/supabase/server';

export interface UploadResult {
  error?: string;
  added?: number;
  alreadyThere?: number;
  duplicatesInFile?: number;
  invalid?: number;
}

export async function uploadLeads(_prev: UploadResult | null, formData: FormData): Promise<UploadResult> {
  let leads: LeadInput[] = [];
  try {
    const file = formData.get('file');
    if (file instanceof File && file.size > 0) leads.push(...csvToLeads(parseCsv(await file.text())));
    leads.push(...pastedUrlsToLeads(String(formData.get('urls') ?? '')));
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (leads.length === 0) return { error: 'Nothing to upload: choose a CSV or paste LinkedIn URLs.' };

  const { valid, invalid, duplicatesInFile } = prepareLeads(leads);
  leads = valid;

  const supabase = await createClient();
  let added = 0;
  for (let i = 0; i < leads.length; i += 500) {
    const { data, error } = await supabase
      .from('leads')
      .upsert(leads.slice(i, i + 500), { onConflict: 'linkedin_url', ignoreDuplicates: true })
      .select('id');
    if (error) return { error: error.message, added };
    added += data?.length ?? 0;
  }
  revalidatePath('/queue');
  revalidatePath('/dashboard');
  return { added, alreadyThere: leads.length - added, duplicatesInFile, invalid };
}
