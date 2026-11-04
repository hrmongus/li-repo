'use client';

import { useActionState, useState, useTransition } from 'react';
import { addVersionB, saveTemplate } from './actions';

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

/** One version (A or B) of a message, editable in place. */
export function TemplateEditor({ t, stats, limit }: { t: EditorTemplate; stats?: string; limit?: number | null }) {
  const [result, action, pending] = useActionState(saveTemplate, null);
  const [body, setBody] = useState(t.body);
  return (
    <form
      action={action}
      className={`flex flex-col rounded-md border p-2 text-sm ${t.active ? 'border-slate-300 bg-white' : 'border-dashed border-slate-300 bg-slate-50'}`}
    >
      <input type="hidden" name="id" value={t.id} />
      <input type="hidden" name="title" value={t.title} />
      <div className="flex items-center gap-2 text-xs">
        <span className="rounded bg-slate-900 px-1.5 py-0.5 font-semibold text-white">{t.version}</span>
        <label className="flex items-center gap-1">
          <input type="checkbox" name="active" defaultChecked={t.active} /> active
        </label>
        {stats && <span className="ml-auto text-slate-500">{stats}</span>}
      </div>
      <textarea
        name="body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={Math.min(16, Math.max(3, body.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 55)), 0) + 1))}
        placeholder="Empty = no message (for invites: connection request without a note)"
        className="mt-2 w-full flex-1 rounded border border-slate-300 p-2"
      />
      <div className="mt-1 flex items-center gap-3 text-xs">
        <span className={limit && body.length > limit ? 'text-red-600' : 'text-slate-500'}>
          {body.length}
          {limit ? `/${limit}` : ''} characters (before placeholders)
        </span>
        {result && <span className={result === 'Saved' ? 'text-green-700' : 'text-red-600'}>{result}</span>}
        <button disabled={pending} className="ml-auto rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
          Save
        </button>
      </div>
    </form>
  );
}

/** Placeholder shown where a message has no B version yet. */
export function AddVersionB({ templateKey }: { templateKey: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2 self-start rounded-md border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500">
      <span>No B version.</span>
      <button
        disabled={pending}
        onClick={() => start(async () => setError(await addVersionB(templateKey)))}
        title="Creates an inactive copy of A. Edit it, tick active, save."
        className="rounded border border-slate-400 px-2 py-0.5 text-slate-700 disabled:opacity-50"
      >
        {pending ? 'Adding…' : 'Add B version'}
      </button>
      {error && <span className="text-red-600">{error}</span>}
    </div>
  );
}
