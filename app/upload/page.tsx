'use client';

import { useActionState } from 'react';
import { uploadLeads } from './actions';

export default function UploadPage() {
  const [result, action, pending] = useActionState(uploadLeads, null);
  return (
    <form action={action} className="flex max-w-2xl flex-col gap-4 text-sm">
      <h1 className="text-lg font-semibold">Upload leads</h1>

      <label className="flex flex-col gap-1">
        <span className="font-medium">CSV file</span>
        <input type="file" name="file" accept=".csv,text/csv" />
        <span className="text-xs text-slate-500">
          Recognized columns: LinkedIn URL (linkedin_url, LinkedIn, LinkedIn profile, url), full name, first
          name, title, company, segment / company type, website, company LinkedIn, email, country. Every other
          column is kept in the lead&apos;s notes. Rows without a LinkedIn profile are imported if they name a
          person (research finds the profile); shared mailboxes without a name are skipped.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-medium">Or paste LinkedIn URLs</span>
        <textarea name="urls" rows={8} placeholder="https://www.linkedin.com/in/..." className="rounded border border-slate-300 p-2" />
      </label>

      <button disabled={pending} className="self-start rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
        {pending ? 'Uploading…' : 'Upload'}
      </button>

      {result?.error && <p className="text-red-600">{result.error}</p>}
      {result && !result.error && (
        <p>
          Added <b>{result.added}</b> new leads ({result.addedWithoutLinkedin} of them without a LinkedIn URL yet).
          Already in the CRM: {result.alreadyThere}. Duplicates in this upload: {result.duplicatesInFile}. Skipped
          (no person&apos;s name or LinkedIn profile): {result.noPerson}.
        </p>
      )}
    </form>
  );
}
