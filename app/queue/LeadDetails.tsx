'use client';

import { useState, useTransition } from 'react';
import { ARTIST_FIELDS, LEAD_FIELDS, type Field } from '@/lib/leadFields';
import { getLeadDetails, saveLeadDetails } from './actions';

type Row = Record<string, unknown>;

const show = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function FieldRow({ field, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  const empty = value === '';
  const base = 'w-full rounded border px-2 py-1 text-sm';
  let input;
  if (!field.editable) {
    input = <span className={`text-sm ${empty ? 'italic text-slate-400' : 'text-slate-600'}`}>{empty ? 'empty' : value}</span>;
  } else if (field.kind === 'select') {
    input = (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${base} border-slate-300 bg-white`}>
        <option value="">(empty)</option>
        {field.options!.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else if (field.kind === 'longtext') {
    input = (
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={Math.min(8, Math.max(2, value.split('\n').length + 1))}
        placeholder="empty" className={`${base} ${empty ? 'border-amber-300' : 'border-slate-300'}`} />
    );
  } else {
    input = (
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="empty"
        inputMode={field.kind === 'int' ? 'numeric' : undefined}
        className={`${base} ${empty ? 'border-amber-300' : 'border-slate-300'}`} />
    );
  }
  return (
    <label className="grid grid-cols-[10rem_1fr] items-start gap-2 py-0.5">
      <span className={`pt-1 text-xs ${field.editable ? 'text-slate-700' : 'text-slate-400'}`}>{field.key}</span>
      {input}
    </label>
  );
}

/** "Show all" button + panel: every lead and artist column, empty ones too; editable fields can be saved. */
export function LeadDetails({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const [lead, setLead] = useState<Record<string, string> | null>(null);
  const [artists, setArtists] = useState<{ id: string; values: Record<string, string> }[]>([]);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const toValues = (row: Row, fields: Field[]) => Object.fromEntries(fields.map((f) => [f.key, show(row[f.key])]));

  const load = () =>
    start(async () => {
      const res = await getLeadDetails(leadId);
      if (res.error || !res.lead) return setMsg({ ok: false, text: res.error ?? 'Lead not found' });
      setLead(toValues(res.lead, LEAD_FIELDS));
      setArtists(res.artists.map((a) => ({ id: String(a.id), values: toValues(a, ARTIST_FIELDS) })));
      setDirty(false);
    });

  const toggle = () => {
    if (!open) load();
    setOpen(!open);
    setMsg(null);
  };

  const save = () =>
    start(async () => {
      if (!lead) return;
      const res = await saveLeadDetails({ leadId, lead, artists });
      if (res.error) return setMsg({ ok: false, text: res.error });
      setMsg({ ok: true, text: res.changed ? `Saved (${res.changed} field${res.changed === 1 ? '' : 's'})` : 'Nothing changed' });
      load();
    });

  return (
    <>
      <button onClick={toggle} className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50">
        {open ? 'Hide all' : 'Show all'}
      </button>
      {open && (
        <div className="mt-3 w-full basis-full rounded border border-slate-200 bg-slate-50 p-3">
          {!lead ? (
            <p className="text-sm text-slate-500">{msg?.text ?? 'Loading…'}</p>
          ) : (
            <>
              <h4 className="mb-1 text-xs font-semibold uppercase text-slate-500">Lead</h4>
              {LEAD_FIELDS.map((f) => (
                <FieldRow key={f.key} field={f} value={lead[f.key]}
                  onChange={(v) => { setLead({ ...lead, [f.key]: v }); setDirty(true); }} />
              ))}
              {artists.length === 0 && <p className="mt-2 text-xs text-slate-400">No artists on this lead.</p>}
              {artists.map((a, i) => (
                <div key={a.id} className="mt-3">
                  <h4 className="mb-1 text-xs font-semibold uppercase text-slate-500">
                    Artist {i + 1}{a.values.is_primary === 'true' ? ' (primary)' : ''}
                  </h4>
                  {ARTIST_FIELDS.map((f) => (
                    <FieldRow key={f.key} field={f} value={a.values[f.key]}
                      onChange={(v) => {
                        setArtists(artists.map((x) => (x.id === a.id ? { ...x, values: { ...x.values, [f.key]: v } } : x)));
                        setDirty(true);
                      }} />
                  ))}
                </div>
              ))}
              <div className="mt-3 flex items-center gap-3">
                <button onClick={save} disabled={pending || !dirty}
                  className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
                  Save changes
                </button>
                <span className="text-xs text-slate-500">Grey fields change only through the step buttons or research.</span>
                {msg && <span className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
