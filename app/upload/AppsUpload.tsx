'use client';

import { useActionState } from 'react';
import { APP_CSV_COLUMNS } from '@/lib/leads';
import { uploadAppLeads } from './appActions';

/** Apps upload: founder CSV (one row per founder). */
export function AppsUpload() {
  const [result, action, pending] = useActionState(uploadAppLeads, null);
  return (
    <div className="flex max-w-2xl flex-col gap-10 text-sm">
      <form action={action} className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Upload app founders</h1>

        <label className="flex flex-col gap-1">
          <span className="font-medium">CSV file</span>
          <input type="file" name="file" accept=".csv,text/csv" />
          <span className="text-xs text-slate-500">
            One row per founder. Columns: {APP_CSV_COLUMNS.join(', ')}. Every other column is kept in the lead&apos;s
            notes. A founder needs a name and at least one contact (LinkedIn, email or X); with both they go straight
            to ready. Founders already in the CRM (same LinkedIn, X or email) are updated: filled cells only, their app
            is replaced, their outreach status is never touched. Max 2 founders per app (same App Store URL); extra
            founders are skipped. Only founders with a LinkedIn URL show up in the Due queue.
          </span>
        </label>

        <button disabled={pending} className="self-start rounded bg-brand-red px-4 py-2 font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {pending ? 'Uploading…' : 'Upload'}
        </button>

        {result?.error && <p className="text-red-600">{result.error}</p>}
        {result && !result.error && (
          <p>
            Added <b>{result.added}</b> new founders, updated <b>{result.updated}</b>. Ready for outreach:{' '}
            <b>{result.ready}</b>. Duplicates in this upload: {result.duplicatesInFile}. Skipped: {result.noFounder} without
            a founder name or contact, {result.overCap} over the 2-founders-per-app limit.
            {(result.conflicts ?? 0) > 0 && (
              <span className="text-red-600"> {result.conflicts} rows couldn&apos;t be applied (LinkedIn URL already on a music lead or another lead).</span>
            )}
          </p>
        )}
      </form>
    </div>
  );
}
