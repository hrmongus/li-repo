'use server';

import { revalidatePath } from 'next/cache';
import { checkMessage, clickButton, clickReplied, step, todayStr, type Transition } from '@/lib/outreach';
import { ARTIST_FIELDS, changedValues, LEAD_FIELDS } from '@/lib/leadFields';
import { createClient } from '@/lib/supabase/server';

async function record(t: Transition & { lead_id: string; template_key?: string | null; version?: string | null; text_sent?: string | null }) {
  const supabase = await createClient();
  const { error } = await supabase.rpc('record_step', {
    p_lead_id: t.lead_id,
    p_from_status: t.from_status,
    p_to_status: t.to_status,
    p_next_action_at: t.next_action_at,
    p_template_key: t.template_key ?? null,
    p_version: t.version ?? null,
    p_text_sent: t.text_sent ?? null,
    p_plan_sent: t.plan_sent,
    p_li_active: t.li_active,
  });
  if (error) return { error: error.message };
  revalidatePath('/queue');
  return { error: null };
}

export async function clickStepAction(input: {
  leadId: string;
  fromStatus: string;
  buttonId: string;
  text: string | null;
  templateKey: string | null;
  version: string | null;
}) {
  try {
    const transition = clickButton(input.fromStatus, input.buttonId, todayStr());
    const button = step(input.fromStatus).buttons.find((b) => b.id === input.buttonId)!;
    if (!button.sends) return record({ ...transition, lead_id: input.leadId });

    const text = input.text ?? '';
    const check = checkMessage(text, step(input.fromStatus).noteLimit ?? null);
    if (!check.canCopy) return { error: check.problems.join('. ') };
    return record({
      ...transition,
      lead_id: input.leadId,
      template_key: input.templateKey,
      version: input.templateKey ? input.version : null,
      text_sent: text,
    });
  } catch (e) {
    return { error: (e as Error).message };
  }
}

type Row = Record<string, unknown>;

/** "Show all": the lead row and its artists, every column. */
export async function getLeadDetails(leadId: string): Promise<{ lead: Row | null; artists: Row[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('leads').select('*, artists(*)').eq('id', leadId).single();
  if (error) return { lead: null, artists: [], error: error.message };
  const { artists, ...lead } = data as Row & { artists: Row[] };
  artists.sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  return { lead, artists, error: null };
}

/**
 * "Show all" save: editable fields only (never status, due date, research status or the
 * LinkedIn check, which belong to the buttons and research). Unchanged fields are not written.
 */
export async function saveLeadDetails(input: {
  leadId: string;
  lead: Record<string, string>;
  artists: { id: string; values: Record<string, string> }[];
}): Promise<{ error: string | null; changed: number }> {
  try {
    const current = await getLeadDetails(input.leadId);
    if (current.error || !current.lead) return { error: current.error ?? 'Lead not found', changed: 0 };
    const supabase = await createClient();
    let changed = 0;

    const leadPatch = changedValues(LEAD_FIELDS, current.lead, input.lead);
    if (Object.keys(leadPatch).length > 0) {
      const { error } = await supabase.from('leads').update(leadPatch).eq('id', input.leadId);
      if (error) {
        const dup = error.code === '23505' ? ' (another lead already has this LinkedIn URL)' : '';
        return { error: error.message + dup, changed };
      }
      changed += Object.keys(leadPatch).length;
    }
    for (const a of input.artists) {
      const before = current.artists.find((x) => x.id === a.id);
      if (!before) continue;
      const patch = changedValues(ARTIST_FIELDS, before, a.values);
      if (Object.keys(patch).length === 0) continue;
      const { error } = await supabase.from('artists').update(patch).eq('id', a.id).eq('lead_id', input.leadId);
      if (error) return { error: error.message, changed };
      changed += Object.keys(patch).length;
    }
    if (changed > 0) revalidatePath('/queue');
    return { error: null, changed };
  } catch (e) {
    return { error: (e as Error).message, changed: 0 };
  }
}

export async function repliedAction(input: { leadId: string; fromStatus: string }) {
  try {
    return record({ ...clickReplied(input.fromStatus, todayStr()), lead_id: input.leadId });
  } catch (e) {
    return { error: (e as Error).message };
  }
}
