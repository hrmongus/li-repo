import { FINAL_STATUSES, FLOW, pathFrom, type Button, type MessageType } from '@/lib/outreach';
import { TemplateEditor, type EditorTemplate } from './TemplateEditor';

// The sequence diagram is drawn from FLOW in lib/outreach.ts, so it follows the sequence when
// it changes. Messages are the message_templates rows whose status is the step they're sent from;
// each message step shows the three message types side by side.

export interface TemplateStat {
  key: string;
  version: string;
  message_type: MessageType;
  step: string;
  leads_sent: number;
  connected: number;
  replied: number;
  call_booked: number;
}

const TYPES: MessageType[] = ['label', 'management', 'agency'];

const LABELS: Record<string, string> = {
  li_check: 'LinkedIn check (VA)',
  to_do: 'Warm up',
  warmed_up: 'Connection request',
  connection_requested: 'Waiting for accept',
  connected: 'Message 1',
  message_1_sent: 'Follow-up nudge',
  follow_up_sent: 'Breakup message',
  breakup_sent: 'No answer',
  replied: 'They replied',
  call_booked: 'Call booked',
  no_reply: 'End: no reply',
  not_accepted: 'End: invite not accepted',
  won: 'End: won',
  lost: 'End: lost',
};
const label = (s: string) => LABELS[s] ?? s;

function wait(b: Button): string {
  if (b.dueInDays === null) return FINAL_STATUSES.includes(b.to) ? 'end' : 'no due date';
  if (b.dueInDays === 0) return 'same day';
  return `next step in ${b.dueInDays} day${b.dueInDays === 1 ? '' : 's'}`;
}

/** The outcome that matters for messages sent from this step. */
function rate(status: string, s: { leads_sent: number; connected: number; replied: number }): string {
  if (s.leads_sent === 0) return 'not sent yet';
  const pct = (n: number) => `${Math.round((100 * n) / s.leads_sent)}%`;
  return status === 'warmed_up'
    ? `sent ${s.leads_sent} · accepted ${pct(s.connected)}`
    : `sent ${s.leads_sent} · replied ${pct(s.replied)}`;
}

/** All-types total per version for one step (e.g. invite A vs invite B across all three types). */
function StepTotals({ status, stats }: { status: string; stats: TemplateStat[] }) {
  const own = stats.filter((s) => s.step === status);
  const versions = [...new Set(own.map((s) => s.version))].sort();
  if (own.length === 0) return null;
  return (
    <p className="mt-1 text-xs text-slate-500">
      All types:{' '}
      {versions
        .map((v) => {
          const rows = own.filter((s) => s.version === v);
          const sum = (k: 'leads_sent' | 'connected' | 'replied') => rows.reduce((n, r) => n + r[k], 0);
          return `${v} ${rate(status, { leads_sent: sum('leads_sent'), connected: sum('connected'), replied: sum('replied') })}`;
        })
        .join('  ·  ')}
    </p>
  );
}

function Messages({ status, templates, stats }: { status: string; templates: EditorTemplate[]; stats: Map<string, TemplateStat> }) {
  const limit = FLOW[status]?.noteLimit ?? null;
  return (
    <div className="mt-3 grid gap-3 lg:grid-cols-3">
      {TYPES.map((type) => {
        const versions = templates.filter((t) => t.audience === type).sort((a, b) => a.version.localeCompare(b.version));
        return (
          <div key={type} className="flex flex-col gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">{type}</div>
            {versions.length === 0 && <p className="text-xs text-red-600">No template for this type.</p>}
            {versions.map((t) => {
              const s = stats.get(`${t.key}:${t.version}`);
              return (
                <TemplateEditor
                  key={t.id}
                  t={t}
                  limit={limit}
                  stats={s ? rate(status, s) : 'not sent yet'}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function Step({
  status,
  n,
  num,
  templates,
  stats,
  statRows,
  mainButtonShownBelow,
}: {
  status: string;
  n: number;
  num?: string;
  templates: EditorTemplate[];
  stats: Map<string, TemplateStat>;
  statRows: TemplateStat[];
  mainButtonShownBelow: boolean;
}) {
  const s = FLOW[status];
  const final = FINAL_STATUSES.includes(status);
  const sideButtons = mainButtonShownBelow ? s.buttons.slice(1) : s.buttons;
  const own = templates.filter((t) => t.status === status);
  return (
    <div id={`step-${status}`} className={`scroll-mt-4 rounded-lg border p-4 ${final ? 'border-slate-200 bg-slate-100' : 'border-slate-300 bg-white'}`}>
      <div className="flex flex-wrap items-baseline gap-x-3">
        {num && (
          <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-red px-1.5 text-xs font-semibold text-white">
            {num}
          </span>
        )}
        <h3 className="font-semibold">{label(status)}</h3>
        <span className="font-mono text-xs text-slate-400">{status}</span>
        <span className="ml-auto text-xs text-slate-500">{n} lead{n === 1 ? '' : 's'} here now</span>
      </div>
      {!final && <p className="mt-1 text-sm text-slate-700">Setter: {s.action}</p>}
      {s.canReply && <p className="mt-1 text-xs text-slate-500">They can reply at this step → “They replied”.</p>}
      {sideButtons.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {sideButtons.map((b) => (
            <span key={b.id} className="rounded-full border border-slate-300 px-2 py-0.5">
              <b>{b.label}</b> → {b.to === status ? 'stays here' : label(b.to)} ({wait(b)})
            </span>
          ))}
        </div>
      )}
      {own.length > 0 && (
        <>
          <StepTotals status={status} stats={statRows} />
          <Messages status={status} templates={own} stats={stats} />
        </>
      )}
    </div>
  );
}

function Arrow({ b }: { b: Button }) {
  return (
    <div className="flex items-center gap-3 py-1 pl-6">
      <div className="h-8 w-px bg-slate-400" />
      <span className="text-xs text-slate-600">
        ↓ <b>{b.label}</b> · {wait(b)}
      </span>
    </div>
  );
}

/** One-line map of the main path: numbered steps with the wait between them. Click to jump. */
function Overview({ statuses }: { statuses: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      {statuses.map((status, i) => {
        const b = statuses[i + 1] ? FLOW[status].buttons[0] : undefined;
        const final = FINAL_STATUSES.includes(status);
        return (
          <span key={status} className="flex items-center gap-1">
            <a
              href={`#step-${status}`}
              className={`rounded-full border px-2 py-0.5 hover:bg-slate-100 ${final ? 'border-slate-200 bg-slate-100' : 'border-slate-300'}`}
            >
              <b>{i + 1}</b> {label(status)}
            </a>
            {b && <span className="text-slate-500">{b.dueInDays ? `—${b.dueInDays}d→` : '→'}</span>}
          </span>
        );
      })}
    </div>
  );
}

export function Sequence({ templates, stats, counts }: { templates: EditorTemplate[]; stats: TemplateStat[]; counts: Map<string, number> }) {
  const statMap = new Map(stats.map((s) => [`${s.key}:${s.version}`, s]));
  const main = pathFrom('li_check');
  const other = Object.keys(FLOW).filter((s) => !main.includes(s) && !FINAL_STATUSES.includes(s));
  const ends = FINAL_STATUSES.filter((s) => !main.includes(s));
  const orphan = templates.filter((t) => !FLOW[t.status]);
  const common = { templates, stats: statMap, statRows: stats };

  return (
    <div className="flex flex-col gap-8">
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <Overview statuses={main} />
        <p className="mt-2 text-xs text-slate-500">
          From step 4 on, a reply stops the sequence: the setter clicks <b>Replied</b> and answers by hand.
        </p>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Main path</h3>
        {main.map((status, i) => {
          const next = main[i + 1];
          const b = next ? FLOW[status].buttons[0] : undefined;
          return (
            <div key={status}>
              <Step status={status} num={`${i + 1}`} n={counts.get(status) ?? 0} mainButtonShownBelow={!!b} {...common} />
              {b && <Arrow b={b} />}
            </div>
          );
        })}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">When they reply</h3>
        <div className="flex flex-col gap-3">
          {other.map((s) => (
            <Step key={s} status={s} n={counts.get(s) ?? 0} mainButtonShownBelow={false} {...common} />
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Other endings</h3>
        <div className="flex flex-wrap gap-2 text-sm">
          {ends.map((s) => (
            <span key={s} className="rounded border border-slate-200 bg-slate-100 px-3 py-1">
              {label(s)} · {counts.get(s) ?? 0}
            </span>
          ))}
        </div>
      </div>

      {orphan.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-red-600">Templates not used by any step</h3>
          <p className="mb-2 text-xs text-slate-500">Their status doesn&apos;t match a step in the sequence, so they&apos;re never shown.</p>
          <div className="grid gap-2 md:grid-cols-2">
            {orphan.map((t) => <TemplateEditor key={t.id} t={t} />)}
          </div>
        </div>
      )}
    </div>
  );
}
