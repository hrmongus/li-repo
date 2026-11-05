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
          name, title, company, company_type (label, management, agency, distributor or other; a "segment" column works too), website, company LinkedIn, email, country. Every other
          column is kept in the lead&apos;s notes. Rows without a LinkedIn profile are imported if they name a
          person (research finds the profile); shared mailboxes without a name are skipped. Researcher CSVs
          (the format in the research guide) are recognized automatically: complete rows go straight to the
          queue, rows with a disqualify_reason are stored as disqualified.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-medium">Or paste LinkedIn URLs</span>
        <textarea name="urls" rows={8} placeholder="https://www.linkedin.com/in/..." className="rounded border border-slate-300 p-2" />
      </label>

      <button disabled={pending} className="self-start rounded bg-brand-red px-4 py-2 font-semibold text-white hover:opacity-90 disabled:opacity-50">
        {pending ? 'Uploading…' : 'Upload'}
      </button>

      {result?.error && <p className="text-red-600">{result.error}</p>}
      {result && !result.error && (
        <p>
          Added <b>{result.added}</b> new leads ({result.addedWithoutLinkedin} of them without a LinkedIn URL yet).
          Already in the CRM: {result.alreadyThere}. Duplicates in this upload: {result.duplicatesInFile}. Skipped
          (no person&apos;s name or LinkedIn profile): {result.noPerson}.
          {(result.ready ?? 0) + (result.disqualified ?? 0) > 0 && (
            <> Of the new leads: <b>{result.ready}</b> ready for outreach, {result.disqualified} disqualified, the rest stay in research.</>
          )}
        </p>
      )}
    </form>
  );
}
