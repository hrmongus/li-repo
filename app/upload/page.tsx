'use client';

import { useActionState } from 'react';
import { uploadLeads } from './actions';

const COUNTRIES = ['US', 'UK', 'CA', 'AU', 'DE', 'NL', 'SE', 'FR', 'IE', 'AT'];

export default function UploadPage() {
  const [result, action, pending] = useActionState(uploadLeads, null);
  return (
    <div className="flex max-w-2xl flex-col gap-10 text-sm">
      <form action={action} className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Upload leads</h1>

        <label className="flex flex-col gap-1">
          <span className="font-medium">CSV file</span>
          <input type="file" name="file" accept=".csv,text/csv" />
          <span className="text-xs text-slate-500">
            Recognized columns: LinkedIn URL (linkedin_url, LinkedIn, LinkedIn profile, url), full name, first
            name, title, company, company_type (label, management, agency, distributor or other; a &quot;segment&quot;
            column works too), website, company LinkedIn, email, country. Every other column is kept in the
            lead&apos;s notes. Rows without a LinkedIn profile are imported if they name a person; shared mailboxes
            without a name are skipped. Researcher CSVs (the format in the research guide) are recognized
            automatically: complete rows go straight to the queue, rows with a disqualify_reason are stored as
            disqualified, and rows with a lead_id (from a backlog export) update that lead.
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-medium">Or paste LinkedIn URLs</span>
          <textarea name="urls" rows={6} placeholder="https://www.linkedin.com/in/..." className="rounded border border-slate-300 p-2" />
        </label>

        <button disabled={pending} className="self-start rounded bg-brand-red px-4 py-2 font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {pending ? 'Uploading…' : 'Upload'}
        </button>

        {result?.error && <p className="text-red-600">{result.error}</p>}
        {result && !result.error && (
          <p>
            Added <b>{result.added}</b> new leads ({result.addedWithoutLinkedin} of them without a LinkedIn URL yet).
            {(result.updated ?? 0) > 0 && <> Updated <b>{result.updated}</b> existing leads.</>} Already in the CRM:{' '}
            {result.alreadyThere}. Duplicates in this upload: {result.duplicatesInFile}. Skipped (no person&apos;s name
            or LinkedIn profile): {result.noPerson}.
            {(result.ready ?? 0) + (result.disqualified ?? 0) > 0 && (
              <> Result: <b>{result.ready}</b> ready for outreach, {result.disqualified} disqualified, the rest stay in research.</>
            )}
            {(result.conflicts ?? 0) > 0 && (
              <span className="text-red-600"> {result.conflicts} rows couldn&apos;t be applied (their LinkedIn URL already belongs to another lead).</span>
            )}
          </p>
        )}
      </form>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Export for researchers</h2>
        <p className="text-xs text-slate-500">
          Give these files to a researcher&apos;s Claude together with the research guide. The skip list stops it from
          researching people and companies we already have. The backlog holds unresearched leads in the researcher
          CSV format; it fills in the research columns and you upload the file back here. To avoid two people working
          the same leads, give each researcher a different country, company type or starting row.
        </p>

        <a href="/export?type=skip" className="self-start rounded border border-slate-300 px-4 py-2 font-semibold hover:border-slate-900">
          Download skip list (all leads)
        </a>

        <form action="/export" method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="type" value="backlog" />
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Country</span>
            <select name="country" defaultValue="US" className="rounded border border-slate-300 px-2 py-1.5">
              <option value="">Any</option>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Company type</span>
            <select name="company_type" defaultValue="" className="rounded border border-slate-300 px-2 py-1.5">
              <option value="">Label, management, agency</option>
              <option value="label">label</option>
              <option value="management">management</option>
              <option value="agency">agency</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Rows</span>
            <input name="limit" type="number" min={1} max={1000} defaultValue={100} className="w-24 rounded border border-slate-300 px-2 py-1.5" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Skip first</span>
            <input name="offset" type="number" min={0} defaultValue={0} className="w-24 rounded border border-slate-300 px-2 py-1.5" />
          </label>
          <button className="rounded border border-slate-300 px-4 py-2 font-semibold hover:border-slate-900">
            Download backlog
          </button>
        </form>
      </section>
    </div>
  );
}
