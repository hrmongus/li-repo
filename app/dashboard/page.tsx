import { FLOW } from '@/lib/outreach';
import { createClient } from '@/lib/supabase/server';
import { TemplateEditor, type EditorTemplate } from './TemplateEditor';

interface Stat {
  key: string;
  version: string;
  title: string;
  active: boolean;
  times_sent: number;
  leads_sent: number;
  connected: number;
  replied: number;
  replied_positive: number;
  call_booked: number;
}

const pct = (n: number, d: number) => (d === 0 ? '–' : `${n} (${Math.round((100 * n) / d)}%)`);

export default async function DashboardPage() {
  const supabase = await createClient();
  const [leadsRes, statsRes, templatesRes] = await Promise.all([
    supabase.from('lead_counts').select('status, research_status, n'),
    supabase.from('template_stats').select('*').order('key').order('version'),
    supabase.from('message_templates').select('*').order('status').order('key').order('version'),
  ]);
  for (const r of [leadsRes, statsRes, templatesRes]) if (r.error) throw new Error(r.error.message);

  // Outreach status counts for ready leads; leads still in research are counted separately.
  const counts = new Map<string, number>();
  let inResearch = 0;
  for (const l of leadsRes.data ?? []) {
    if (l.research_status !== 'ready') inResearch += l.n;
    else counts.set(l.status, (counts.get(l.status) ?? 0) + l.n);
  }
  const statuses = [...Object.keys(FLOW), ...[...counts.keys()].filter((s) => !(s in FLOW))];
  const stats = (statsRes.data ?? []) as Stat[];
  const templates = (templatesRes.data ?? []) as EditorTemplate[];

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-2 font-semibold">Leads per status</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded border border-amber-200 bg-amber-50 p-2 text-sm">
            <div className="text-xs text-slate-500">in research</div>
            <div className="text-lg font-semibold">{inResearch}</div>
          </div>
          {statuses.map((s) => (
            <div key={s} className="rounded border border-slate-200 bg-white p-2 text-sm">
              <div className="text-xs text-slate-500">{s}</div>
              <div className="text-lg font-semibold">{counts.get(s) ?? 0}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1 font-semibold">A/B stats per template</h2>
        <p className="mb-2 text-xs text-slate-500">
          Of the leads that got this template, how many later connected / replied / replied positively / booked a call.
          Read each template on its own step&apos;s goal: invites → connected, message 1 → replied, replies → call booked.
        </p>
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="p-2">Template</th><th className="p-2">Ver</th><th className="p-2">Sent</th>
                <th className="p-2">Connected</th><th className="p-2">Replied</th>
                <th className="p-2">Positive</th><th className="p-2">Call booked</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={`${s.key}:${s.version}`} className={`border-t border-slate-100 ${s.active ? '' : 'text-slate-400'}`}>
                  <td className="p-2 font-mono text-xs">{s.key}</td>
                  <td className="p-2">{s.version}</td>
                  <td className="p-2">{s.leads_sent}</td>
                  <td className="p-2">{pct(s.connected, s.leads_sent)}</td>
                  <td className="p-2">{pct(s.replied, s.leads_sent)}</td>
                  <td className="p-2">{pct(s.replied_positive, s.leads_sent)}</td>
                  <td className="p-2">{pct(s.call_booked, s.leads_sent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-1 font-semibold">Templates</h2>
        <p className="mb-2 text-xs text-slate-500">
          Placeholders: {'{First} {Company} {Artist} {Song} {date} {N} {hookLine} {Samples}'}. Text in [square brackets]
          blocks Copy until the setter replaces it.
        </p>
        <div className="flex flex-col gap-2">
          {templates.map((t) => <TemplateEditor key={t.id} t={t} />)}
        </div>
      </section>
    </div>
  );
}
