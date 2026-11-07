'use client';

/** Status dropdown for the Due view; changing it reloads the page with ?status=… */
export function StatusFilter({ value, options }: { value: string; options: { status: string; count: number }[] }) {
  return (
    <form className="text-sm">
      <select
        name="status"
        defaultValue={value}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded border border-slate-300 bg-white px-2 py-1.5"
      >
        <option value="">All statuses ({options.reduce((n, o) => n + o.count, 0)})</option>
        {options.map((o) => (
          <option key={o.status} value={o.status}>
            {o.status} ({o.count})
          </option>
        ))}
      </select>
      <noscript>
        <button className="ml-2 rounded bg-slate-900 px-3 py-1.5 text-white">Filter</button>
      </noscript>
    </form>
  );
}
