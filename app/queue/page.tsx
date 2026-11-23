import Link from 'next/link';
import { cookies } from 'next/headers';
import {
  dayStartUtc,
  inTab,
  isSender,
  SENDERS,
  type QueueTab,
  FLOW,
  messageType,
  pickTemplate,
  queueScore,
  renderMessage,
  step,
  daysBetween,
  todayStr,
  onHold,
  type Artist,
  type HoldLead,
  type Lead,
  type Template,
} from '@/lib/outreach';
import { createClient } from '@/lib/supabase/server';
import { LeadCard, type CardProps } from './LeadCard';
import { RememberTab } from './RememberTab';
import { StatusFilter } from './StatusFilter';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const RESEARCH = ['new', 'artists_found', 'enriched', 'ready', 'disqualified'];
const COMPANY_TYPES = ['label', 'management', 'agency', 'distributor', 'other'];

/**
 * "active (checked 4 Nov)" / "inactive (checked 4 Nov)" / null (not checked yet).
 * A VA check stores the check date as the activity date, so show active/inactive, not "days ago".
 */
function activityLabel(last: string | null, checked: string | null, today: string): string | null {
  if (!checked) return null;
  const ago = daysBetween(checked, today);
  const when = ago <= 0 ? 'checked today' : `checked ${ago} day${ago === 1 ? '' : 's'} ago`;
  if (!last) return `inactive (${when})`;
  return daysBetween(last, checked) <= 180 ? `active (${when})` : `inactive (${when})`;
}

function slug(url: string | null): string {
  if (!url) return '(no name)';
  const s = url.replace('https://www.linkedin.com/in/', '');
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function toArtist(a: Row | null | undefined): Artist | null {
  if (!a) return null;
  return {
    name: a.name,
    monthly_listeners: a.monthly_listeners,
    latest_release_title: a.latest_release_title,
    top_cities: a.top_cities,
  };
}

/** Why the current profile can't click this lead's buttons (null = it can). The database checks too. */
function blockedFor(l: Row, acting: string | null): string | null {
  if (l.status === 'li_check') return null; // LinkedIn check is VA work, not profile work
  if (!acting) return 'Pick your profile tab (Andrej, Narek or Mher) to work this lead.';
  if (l.sender && l.sender !== acting) return `Belongs to ${l.sender}: work it from the ${l.sender} tab.`;
  if (!l.sender && l.company_sender && l.company_sender !== acting) return `${l.company_sender} works this company.`;
  if (!l.sender && l.status !== 'to_do') return 'No profile assigned yet.';
  return null;
}

function toCard(l: Row, artist: Artist | null, templates: Template[], today: string, withScore: boolean, acting: string | null): CardProps {
  const lead = l as Lead;
  const type = messageType(l.company_type);
  // Agencies have no artist; label and management leads need their primary artist.
  const ready = l.research_status === 'ready' && type !== null && (type === 'agency' || artist !== null) && FLOW[l.status] !== undefined;
  const s = ready ? step(l.status) : null;
  let message: CardProps['message'] = null;
  if (s && s.buttons.some((b) => b.sends)) {
    const t = pickTemplate(templates, lead);
    message = t
      ? { text: renderMessage(t, lead, artist).text, templateKey: t.key, version: t.version, templateTitle: t.title }
      : { text: '', templateKey: null, version: null, templateTitle: null };
  }
  const extra: string[] = [];
  if (artist?.latest_release_title) extra.push(`latest: ${artist.latest_release_title}`);
  if (artist?.top_cities) extra.push(`top cities: ${artist.top_cities}`);

  return {
    leadId: l.id,
    name: l.full_name || l.first_name || slug(l.linkedin_url),
    title: l.title,
    company: [l.company_name, l.company_type && !type ? `(${l.company_type})` : null].filter(Boolean).join(' ') || null,
    linkedinUrl: l.linkedin_url,
    researchStatus: l.research_status,
    status: l.status,
    nextActionAt: l.next_action_at,
    messageType: type,
    disqualifyReason: l.disqualify_reason,
    planUrl: l.plan_url,
    liActivity: activityLabel(l.last_li_activity, l.li_checked_at, today),
    score: withScore && ready ? queueScore(lead, today) : null,
    artist: artist ? { name: artist.name, listeners: artist.monthly_listeners, extra } : null,
    ready,
    action: s?.action ?? '',
    buttons: s?.buttons ?? [],
    canReply: s?.canReply ?? false,
    message,
    noteLimit: s?.noteLimit ?? null,
    owner: l.sender ?? null,
    actingSender: acting,
    blocked: ready ? blockedFor(l, acting) : null,
  };
}

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; status?: string; research?: string; type?: string; p?: string }>;
}) {
  const sp = await searchParams;
  const view = sp.view === 'all' ? 'all' : 'due';
  // Which profile is working (tab). Remembered in a cookie so a setter stays on their own tab.
  const saved = (await cookies()).get('queue_tab')?.value;
  const pick = sp.p ?? saved;
  const qtab: QueueTab = isSender(pick) ? pick : 'li_check';
  const acting = qtab === 'li_check' ? null : qtab;
  const today = todayStr();
  const supabase = await createClient();

  const { data: templateRows, error: tErr } = await supabase.from('message_templates').select('*').eq('active', true);
  if (tErr) throw new Error(tErr.message);
  const templates = (templateRows ?? []) as Template[];

  // Connection requests sent today per profile ("Sent" clicks on warmed_up), reset at midnight Bratislava time.
  const { data: inviteRows, error: iErr } = await supabase
    .from('activity')
    .select('sender')
    .eq('from_status', 'warmed_up')
    .eq('to_status', 'connection_requested')
    .gte('created_at', dayStartUtc(today));
  if (iErr) throw new Error(iErr.message);
  const invites = SENDERS.map((x) => ({ ...x, sent: (inviteRows ?? []).filter((r) => r.sender === x.name).length }));

  let cards: CardProps[];
  // Due view: statuses present today with counts (in sequence order), for the status dropdown.
  let statusOptions: { status: string; count: number }[] = [];
  let held = 0;
  if (view === 'due') {
    const { data, error } = await supabase.from('queue').select('*');
    if (error) throw new Error(error.message);
    // Active first: inactive contacts wait while an active colleague at the company is still in play.
    const ready: HoldLead[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: page, error: rErr } = await supabase
        .from('leads')
        .select('id, company_name, status, last_li_activity, li_checked_at')
        .eq('research_status', 'ready')
        .range(from, from + 999);
      if (rErr) throw new Error(rErr.message);
      ready.push(...((page ?? []) as HoldLead[]));
      if (!page || page.length < 1000) break;
    }
    const mine = (data ?? []).filter((r) => inTab(r, qtab));
    const rows = mine.filter((r) => !onHold(r as HoldLead, ready));
    held = mine.length - rows.length;
    const all = rows
      .map((r) => toCard(r, r.artist_id ? toArtist({ ...r, name: r.artist_name }) : null, templates, today, true, acting))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    statusOptions = Object.keys(FLOW)
      .map((status) => ({ status, count: all.filter((c) => c.status === status).length }))
      .filter((o) => o.count > 0 || o.status === sp.status);
    cards = sp.status ? all.filter((c) => c.status === sp.status) : all;
  } else {
    let query = supabase.from('leads').select('*, artists(*)').order('created_at', { ascending: false }).limit(200);
    const q = (sp.q ?? '').replace(/[,()%*\\]/g, ' ').trim();
    if (q) query = query.or(`full_name.ilike.%${q}%,company_name.ilike.%${q}%`);
    if (sp.status) query = query.eq('status', sp.status);
    if (sp.research) query = query.eq('research_status', sp.research);
    if (sp.type) query = query.eq('company_type', sp.type);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    cards = (data ?? []).map((l) =>
      toCard(l, toArtist((l.artists as Row[]).find((a) => a.is_primary)), templates, today, false, acting),
    );
  }

  const tab = (v: string, label: string) => (
    <Link
      href={v === 'all' ? `/queue?view=all&p=${qtab}` : `/queue?p=${qtab}`}
      className={`rounded px-3 py-1.5 text-sm ${view === v ? 'bg-slate-900 text-white' : 'border border-slate-300'}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="flex flex-col gap-4">
      <RememberTab tab={qtab} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Working as:</span>
        {(['li_check', ...SENDERS.map((x) => x.name)] as QueueTab[]).map((t) => (
          <Link key={t} href={`/queue?${new URLSearchParams({ ...(view === 'all' ? { view: 'all' } : {}), p: t })}`}
            className={`rounded px-3 py-1.5 ${qtab === t ? 'bg-brand-red font-semibold text-white' : 'border border-slate-300'}`}>
            {t === 'li_check' ? 'LinkedIn check (VA)' : t}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
        <span>Connection requests today:</span>
        {invites.map((x) => (
          <span key={x.name} className={`${x.sent >= x.dailyLimit ? 'font-semibold text-red-700' : ''} ${qtab === x.name ? 'underline' : ''}`}>
            {x.name} {x.sent}/{x.dailyLimit}{x.sent >= x.dailyLimit ? ' (limit reached)' : ''}
          </span>
        ))}
        <span className="text-xs text-slate-500">(resets at midnight, Slovakia time)</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {tab('due', 'Due')}
        {tab('all', 'All leads')}
        {view === 'due' && <StatusFilter key={sp.status ?? ''} value={sp.status ?? ''} options={statusOptions} tab={qtab} />}
        <span className="ml-auto text-sm text-slate-500">
          {cards.length} {view === 'due' ? 'due today' : 'leads'}
          {view === 'all' && cards.length === 200 ? ' (first 200, narrow the search)' : ''}
          {view === 'due' && held > 0 ? ` · ${held} inactive on hold (an active colleague is still in play)` : ''}
        </span>
      </div>

      {view === 'all' && (
        <form className="flex flex-wrap gap-2 text-sm">
          <input type="hidden" name="view" value="all" />
          <input type="hidden" name="p" value={qtab} />
          <input name="q" defaultValue={sp.q} placeholder="Search name or company"
            className="min-w-56 flex-1 rounded border border-slate-300 px-3 py-1.5" />
          <select name="status" defaultValue={sp.status ?? ''} className="rounded border border-slate-300 px-2 py-1.5">
            <option value="">Any status</option>
            {Object.keys(FLOW).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select name="research" defaultValue={sp.research ?? ''} className="rounded border border-slate-300 px-2 py-1.5">
            <option value="">Any research status</option>
            {RESEARCH.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select name="type" defaultValue={sp.type ?? ''} className="rounded border border-slate-300 px-2 py-1.5">
            <option value="">Any company type</option>
            {COMPANY_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="rounded bg-slate-900 px-3 py-1.5 text-white">Filter</button>
        </form>
      )}

      {cards.length === 0 && (
        <p className="text-sm text-slate-500">{view === 'due' ? 'Nothing due. Nice.' : 'No leads match.'}</p>
      )}
      {cards.map((c) => (
        <LeadCard key={`${c.leadId}:${c.status}:${c.message?.templateKey}:${c.nextActionAt}`} {...c} />
      ))}
    </div>
  );
}
