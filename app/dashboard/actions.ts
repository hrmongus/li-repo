'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function saveTemplate(_prev: string | null, formData: FormData): Promise<string | null> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('message_templates')
    .update({
      title: String(formData.get('title') ?? ''),
      body: String(formData.get('body') ?? ''),
      active: formData.get('active') === 'on',
    })
    .eq('id', String(formData.get('id')));
  if (error) return `Error: ${error.message}`;
  revalidatePath('/dashboard');
  revalidatePath('/queue');
  return 'Saved';
}

/** Create a B version of a template as an inactive copy of A, to edit and then switch on. */
export async function addVersionB(key: string): Promise<string | null> {
  const supabase = await createClient();
  const { data: a, error: readError } = await supabase
    .from('message_templates')
    .select('key, status, audience, reply_type, title, body')
    .eq('key', key)
    .eq('version', 'A')
    .single();
  if (readError) return readError.message;
  const { error } = await supabase
    .from('message_templates')
    .insert({ ...a, version: 'B', title: `${a.title} (B)`, active: false });
  if (error) return error.message;
  revalidatePath('/dashboard');
  return null;
}
