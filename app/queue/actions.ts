'use server';

import { revalidatePath } from 'next/cache';
import { checkMessage, clickButton, clickReplied, step, todayStr, type Transition } from '@/lib/outreach';
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

export async function repliedAction(input: { leadId: string; fromStatus: string }) {
  try {
    return record({ ...clickReplied(input.fromStatus, todayStr()), lead_id: input.leadId });
  } catch (e) {
    return { error: (e as Error).message };
  }
}
