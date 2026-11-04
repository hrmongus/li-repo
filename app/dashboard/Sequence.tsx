import { FINAL_STATUSES, FLOW, REPLY_TYPES, pathFrom, type Button } from '@/lib/outreach';
import { AddVersionB, TemplateEditor, type EditorTemplate } from './TemplateEditor';

// The sequence diagram is drawn from FLOW in lib/outreach.ts, so it follows the sequence when
// it changes. Messages are the message_templates rows whose status is the step they're sent from.

export interface TemplateStat {
  key: string;
  version: string;
  leads_sent: number;
  connected: number;
  replied: number;
  replied_positive: number;
  call_booked: number;
}

const LABELS: Record<string, string> = {
  to_do: 'Warm up',
  warmed_up: 'Connection request',
  connection_requested: 'Waiting for accept',
  connected: 'Message 1',
  message_1_sent: 'Voice note',
  follow_up_1_sent: 'Follow-up: samples anyway',
  follow_up_2_sent: 'Breakup message',
  replied: 'They replied',
  reply_sent: 'Waiting for their answer',
  samples_sent: 'Samples nudge',
  samples_nudged: 'Waiting after nudge',
  call_booked: 'Call booked',
  no_reply: 'End: no reply',
  not_accepted: 'End: invite not accepted',
  won: 'End: won',
  lost: 'End: lost',
};
const label = (s: string) => LABELS[s] ?? s;

const AUDIENCE_ORDER = ['label', 'manager', 'release'];

function wait(b: Button): string {
  if (b.dueInDays === null) return FINAL_STATUSES.includes(b.to) ? 'end' : 'no due date';
  if (b.dueInDays === 0) return 'same day';
  return `next step in ${b.dueInDays} day${b.dueInDays === 1 ? '' : 's'}`;
}

/** Which stat matters for messages sent from this step. */
function statLine(status: string, s: TemplateStat | undefined): string {
  if (!s || s.leads_sent === 0) return 'not sent yet';
  const pct = (n: number) => `${Math.round((100 * n) / s.leads_sent)}%`;
  if (status === 'warmed_up') return `sent ${s.leads_sent} · accepted ${pct(s.connected)}`;
  if (status === 'replied') return `sent ${s.leads_sent} · call booked ${pct(s.call_booked)}`;
  return `sent ${s.leads_sent} · replied ${pct(s.replied)} · positive ${pct(s.replied_positive)}`;
}

function Messages({ status, templates, stats }: { status: string; templates: EditorTemplate[]; stats: Map<string, TemplateStat> }) {
  const keys = [...new Set(templates.map((t) => t.key))].sort((a, b) => {
    const ta = templates.find((t) => t.key === a)!;
    const tb = templates.find((t) => t.key === b)!;
    if (ta.reply_type || tb.reply_type) {
      return REPLY_TYPES.indexOf(ta.reply_type as never) - REPLY_TYPES.indexOf(tb.reply_type as never);
    }
    return AUDIENCE_ORDER.indexOf(ta.audience ?? '') - AUDIENCE_ORDER.indexOf(tb.audience ?? '');
  });
  const limit = FLOW[status]?.noteLimit ?? null;
  return (
    <div className="mt-3 flex flex-col gap-3">
      {keys.map((key) => {
        const versions = templates.filter((t) => t.key === key);
        const a = versions.find((t) => t.version === 'A');
        const b = versions.find((t) => t.version === 'B');
        const first = versions[0];
        const who = first.reply_type
          ? `when the reply is “${first.reply_type}”`
          : first.audience
            ? `for ${first.audience === 'release' ? 'artists with a release in 14–56 days' : first.audience === 'manager' ? 'management companies' : 'labels'}`
            : 'for everyone';
        return (
          <div key={key}>
            <div className="mb-1 text-xs text-slate-600">
              <span className="font-mono">{key}</span> · {who}
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {a ? <TemplateEditor t={a} limit={limit} stats={statLine(status, stats.get(`${key}:A`))} /> : <div />}
              {b ? (
                <TemplateEditor t={b} limit={limit} stats={statLine(status, stats.get(`${key}:B`))} />
              ) : (
                <AddVersionB templateKey={key} />
              )}
            </div>
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
  mainButtonShownBelow,
}: {
  status: string;
  n: number;
  num?: string;
  templates: EditorTemplate[];
  stats: Map<string, TemplateStat>;
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
          <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-900 px-1.5 text-xs font-semibold text-white">
            {num}
          </span>
        )}
        <h3 className="font-semibold">{label(status)}</h3>
        <span className="font-mono text-xs text-slate-400">{status}</span>
        <span className="ml-auto text-xs text-slate-500">{n} lead{n === 1 ? '' : 's'} here now</span>
      </div>
      {!final && <p className="mt-1 text-sm text-slate-700">Setter: {s.action}</p>}
      {s.canReply && !final && (
        <p className="mt-1 text-xs text-slate-500">They can reply at this step → “They replied”.</p>
      )}
      {sideButtons.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {sideButtons.map((b) => (
            <span key={b.id} className="rounded-full border border-slate-300 px-2 py-0.5">
              <b>{b.label}</b> → {label(b.to)} ({wait(b)})
            </span>
          ))}
        </div>
      )}
      {own.length > 0 && <Messages status={status} templates={own} stats={stats} />}
      {!final && own.length === 0 && s.buttons.some((b) => b.sends) && (
        <p className="mt-2 text-xs text-slate-500">No template: the setter writes this message by hand.</p>
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

function Path({ statuses, prefix, counts, templates, stats }: { statuses: string[]; prefix: string; counts: Map<string, number>; templates: EditorTemplate[]; stats: Map<string, TemplateStat> }) {
  return (
    <div>
      {statuses.map((status, i) => {
        const next = statuses[i + 1];
        const main = next ? FLOW[status].buttons[0] : undefined;
        return (
          <div key={status}>
            <Step status={status} num={`${prefix}${i + 1}`} n={counts.get(status) ?? 0} templates={templates} stats={stats} mainButtonShownBelow={!!main} />
            {main && <Arrow b={main} />}
          </div>
        );
      })}
    </div>
  );
}

/** One-line map of a path: numbered steps with the wait between them. Click to jump. */
function Overview({ statuses, prefix }: { statuses: string[]; prefix: string }) {
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
              <b>{prefix}{i + 1}</b> {label(status)}
            </a>
            {b && (
              <span className="text-slate-500">
                {b.dueInDays ? `—${b.dueInDays}d→` : '→'}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

export function Sequence({ templates, stats, counts }: { templates: EditorTemplate[]; stats: TemplateStat[]; counts: Map<string, number> }) {
  const statMap = new Map(stats.map((s) => [`${s.key}:${s.version}`, s]));
  const main = pathFrom('to_do');
  const reply = pathFrom('replied');
  const other = Object.keys(FLOW).filter(
    (s) => !main.includes(s) && !reply.includes(s) && !FINAL_STATUSES.includes(s),
  );
  const ends = FINAL_STATUSES.filter((s) => !main.includes(s) && !reply.includes(s));
  const orphan = templates.filter((t) => !FLOW[t.status]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <Overview statuses={main} prefix="" />
        <Overview statuses={reply} prefix="R" />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Main path</h3>
        <Path statuses={main} prefix="" counts={counts} templates={templates} stats={statMap} />
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">When they reply</h3>
        <p className="mb-2 text-xs text-slate-500">
          From “Message 1” on, the setter clicks <b>Replied</b> and picks the reply type. The lead jumps here, due the
          same day, and gets the reply message for that type.
        </p>
        <Path statuses={reply} prefix="R" counts={counts} templates={templates} stats={statMap} />
      </div>

      {other.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Other steps</h3>
          <div className="flex flex-col gap-3">
            {other.map((s) => (
              <Step key={s} status={s} n={counts.get(s) ?? 0} templates={templates} stats={statMap} mainButtonShownBelow={false} />
            ))}
          </div>
        </div>
      )}

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
