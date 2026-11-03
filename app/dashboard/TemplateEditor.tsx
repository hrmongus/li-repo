'use client';

import { useActionState, useState } from 'react';
import { saveTemplate } from './actions';

export interface EditorTemplate {
  id: string;
  key: string;
  version: string;
  status: string;
  audience: string | null;
  reply_type: string | null;
  title: string;
  body: string;
  active: boolean;
}

export function TemplateEditor({ t }: { t: EditorTemplate }) {
  const [result, action, pending] = useActionState(saveTemplate, null);
  const [body, setBody] = useState(t.body);
  return (
    <form action={action} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <input type="hidden" name="id" value={t.id} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs">{t.key} · {t.version}</span>
        <span className="text-xs text-slate-500">
          from {t.status}
          {t.audience ? ` · ${t.audience}` : ''}
          {t.reply_type ? ` · ${t.reply_type}` : ''}
        </span>
        <label className="ml-auto flex items-center gap-1 text-xs">
          <input type="checkbox" name="active" defaultChecked={t.active} /> active
        </label>
      </div>
      <input name="title" defaultValue={t.title} className="mt-2 w-full rounded border border-slate-300 px-2 py-1" />
      <textarea
        name="body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={Math.min(10, Math.max(2, body.split('\n').length + 1))}
        placeholder="Empty = no message (invites: connection request without a note)"
        className="mt-2 w-full rounded border border-slate-300 p-2"
      />
      <div className="mt-1 flex items-center gap-3 text-xs">
        <span className="text-slate-500">{body.length} characters (before placeholders)</span>
        {result && <span className={result === 'Saved' ? 'text-green-700' : 'text-red-600'}>{result}</span>}
        <button disabled={pending} className="ml-auto rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
          Save
        </button>
      </div>
    </form>
  );
}
