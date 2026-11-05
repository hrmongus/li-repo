import { DISQUALIFY_REASONS, FLOW, pathFrom } from '@/lib/outreach';
import { createClient } from '@/lib/supabase/server';
import { Sequence, type TemplateStat } from './Sequence';
import { type EditorTemplate } from './TemplateEditor';

interface Stat extends TemplateStat {
  title: string;
  active: boolean;
  times_sent: number;
}

const pct = (n: number, d: number) => (d === 0 ? '–' : `${n} (${Math.round((100 * n) / d)}%)`);

function Box({ label, n, tone = 'plain' }: { label: string; n: number; tone?: 'plain' | 'amber' | 'red' }) {
  const cls =
    tone === 'amber' ? 'border-amber-200 bg-amber-50' : tone === 'red' ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white';
  return (
    <div className={`rounded border p-2 text-sm ${cls}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold">{n}</div>
    </div>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const [leadsRes, statsRes, templatesRes] = await Promise.all([
    supabase.from('lead_counts').select('status, research_status, disqualify_reason, n'),
    supabase.from('template_stats').select('*').order('key').order('version'),
    supabase.from('message_templates').select('*').order('status').order('key').order('version'),
  ]);
  for (const r of [leadsRes, statsRes, templatesRes]) if (r.error) throw new Error(r.error.message);

  // Outreach status counts for ready leads; research and disqualified leads are counted separately.
  const counts = new Map<string, number>();
  const reasons = new Map<string, number>();
  let inResearch = 0;
  for (const l of leadsRes.data ?? []) {
    if (l.research_status === 'disqualified') reasons.set(l.disqualify_reason, (reasons.get(l.disqualify_reason) ?? 0) + l.n);
    else if (l.research_status !== 'ready') inResearch += l.n;
    else counts.set(l.status, (counts.get(l.status) ?? 0) + l.n);
  }
  const statuses = [...Object.keys(FLOW), ...[...counts.keys()].filter((s) => !(s in FLOW))];
  const stats = (statsRes.data ?? []) as Stat[];
  const templates = (templatesRes.data ?? []) as EditorTemplate[];

  // A/B table: per message step, one row per type + version, then an all-types row per version.
  const messageSteps = pathFrom('li_check').filter((s) => stats.some((r) => r.step === s));

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-2 font-semibold">Leads per status</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Box label="in research" n={inResearch} tone="amber" />
          {statuses.map((s) => (
            <Box key={s} label={s} n={counts.get(s) ?? 0} />
          ))}
        </div>
        <h3 className="mb-2 mt-4 text-sm font-semibold">Disqualified, per reason</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
          {DISQUALIFY_REASONS.map((r) => (
            <Box key={r} label={r} n={reasons.get(r) ?? 0} tone="red" />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1 font-semibold">Sequence and messages</h2>
        <p className="mb-4 text-xs text-slate-500">
          What the setter does at each step, which button moves the lead on, and when the next step is due. Each message
          step shows label / management / agency side by side; edit the text right here. Placeholders:{' '}
          {'{First} {Company} {Artist} {Song} {City}'} (agency messages use only {'{First}'} and {'{Company}'}). Text in
          [square brackets] blocks Copy until the setter replaces it. One A/B test at a time: only the invites have a B
          version (no note).
        </p>
        <Sequence templates={templates} stats={stats} counts={counts} />
      </section>

      <details>
        <summary className="cursor-pointer font-semibold">A/B stats table</summary>
        <p className="mb-2 mt-1 text-xs text-slate-500">
          Of the leads that got this message, how many later connected / replied / booked a call. Read each step on its
          own goal: invites → connected, messages → replied.
        </p>
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="p-2">Step</th><th className="p-2">Type</th><th className="p-2">Ver</th><th className="p-2">Sent</th>
                <th className="p-2">Connected</th><th className="p-2">Replied</th><th className="p-2">Call booked</th>
              </tr>
            </thead>
            <tbody>
              {messageSteps.flatMap((step) => {
                const rows = stats.filter((r) => r.step === step);
                const versions = [...new Set(rows.map((r) => r.version))].sort();
                const totals = versions.map((v) => {
                  const vr = rows.filter((r) => r.version === v);
                  const sum = (k: 'leads_sent' | 'connected' | 'replied' | 'call_booked') => vr.reduce((n, r) => n + r[k], 0);
                  return { v, sent: sum('leads_sent'), connected: sum('connected'), replied: sum('replied'), call: sum('call_booked') };
                });
                return [
                  ...rows.map((s) => (
                    <tr key={`${s.key}:${s.version}`} className={`border-t border-slate-100 ${s.active ? '' : 'text-slate-400'}`}>
                      <td className="p-2 font-mono text-xs">{step}</td>
                      <td className="p-2">{s.message_type}</td>
                      <td className="p-2">{s.version}</td>
                      <td className="p-2">{s.leads_sent}</td>
                      <td className="p-2">{pct(s.connected, s.leads_sent)}</td>
                      <td className="p-2">{pct(s.replied, s.leads_sent)}</td>
                      <td className="p-2">{pct(s.call_booked, s.leads_sent)}</td>
                    </tr>
                  )),
                  ...totals.map((t) => (
                    <tr key={`${step}:total:${t.v}`} className="border-t border-slate-200 bg-slate-50 font-medium">
                      <td className="p-2 font-mono text-xs">{step}</td>
                      <td className="p-2">all types</td>
                      <td className="p-2">{t.v}</td>
                      <td className="p-2">{t.sent}</td>
                      <td className="p-2">{pct(t.connected, t.sent)}</td>
                      <td className="p-2">{pct(t.replied, t.sent)}</td>
                      <td className="p-2">{pct(t.call, t.sent)}</td>
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
