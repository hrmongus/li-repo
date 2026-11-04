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
