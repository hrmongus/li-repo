import Link from 'next/link';
import { cookies } from 'next/headers';
import {
  dayStartUtc,
  inTab,
  isSender,
  SENDERS,
  sendsInviteNote,
  type QueueTab,
  FLOW,
  IG_FLOW,
  IG_START,
  flowFor,
  type Channel,
  messageType,
  pickTemplate,
  queueScore,
  renderMessage,
  step,
  daysBetween,
  todayStr,
  onHold,
  type App,
  type Artist,
  type HoldLead,
  type Lead,
  type Template,
} from '@/lib/outreach';
import { createClient } from '@/lib/supabase/server';
import { getVertical } from '../vertical';
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

function toApp(a: Row | null | undefined): App | null {
  if (!a || !a.app_name) return null;
  return { app_name: a.app_name, rating_count: a.rating_count ?? null, genre: a.genre ?? null };
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

function toCard(
  l: Row, artist: Artist | null, templates: Template[], today: string, withScore: boolean, acting: string | null,
  app: App | null = null, channel: Channel = 'li',
): CardProps {
  const ig = channel === 'ig';
  // Instagram (apps): its own step and due date on the same lead (ig_status, ig_next_action_at).
  const status: string = ig ? (l.ig_status ?? IG_START) : l.status;
  const nextActionAt: string | null = ig ? l.ig_next_action_at : l.next_action_at;
  const lead = { ...(l as Lead), status, next_action_at: nextActionAt };
  const type = messageType(l.company_type);
  // Agencies and app founders need no artist; label and management leads need their primary artist.
  const ready = l.research_status === 'ready' && type !== null && (type === 'agency' || type === 'app' || artist !== null) && flowFor(channel)[status] !== undefined;
  const s = ready ? step(status) : null;
  let message: CardProps['message'] = null;
  if (!ig && s && s.buttons.some((b) => b.sends) && status === 'warmed_up' && acting && !sendsInviteNote(acting)) {
    // No Premium: the request goes out without a note, and isn't counted in the invite A stats.
    message = { text: '', templateKey: null, version: null, templateTitle: null, noNote: acting };
  } else if (s && s.buttons.some((b) => b.sends)) {
    const t = pickTemplate(templates, lead);
    message = t
      ? { text: renderMessage(t, lead, artist, app).text, templateKey: t.key, version: t.version, templateTitle: t.title }
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
    status,
    nextActionAt,
    messageType: type,
    disqualifyReason: l.disqualify_reason,
    planUrl: l.plan_url,
    liActivity: ig ? null : activityLabel(l.last_li_activity, l.li_checked_at, today),
    // Instagram: LinkedIn activity doesn't count there.
    score: withScore && ready ? queueScore(ig ? { ...lead, last_li_activity: null, li_checked_at: null } : lead, today) : null,
    artist: artist && type !== 'app' ? { name: artist.name, listeners: artist.monthly_listeners, extra } : null,
    app:
      type === 'app'
        ? {
            name: app?.app_name ?? null,
            ratingCount: app?.rating_count ?? null,
            genre: app?.genre ?? null,
            xUrl: l.x_url ?? null,
            crunchbaseUrl: l.crunchbase_url ?? null,
            website: l.company_website ?? null,
            email: l.email ?? null,
            emailType: l.email_type ?? null,
            instagramUrl: l.instagram_url ?? l.lead_instagram_url ?? null,
            companyInstagramUrl: l.company_instagram_url ?? null,
          }
        : null,
    channel,
    otherChannel:
      type !== 'app'
        ? null
        : ig
          ? l.linkedin_url && l.research_status === 'ready' ? `LinkedIn: ${l.status}` : null
          : l.ig_status
            ? `Instagram: ${l.ig_status}`
            : null,
    ready,
    action: s?.action ?? '',
    buttons: s?.buttons ?? [],
    canReply: s?.canReply ?? false,
    message,
    noteLimit: s?.noteLimit ?? null,
    owner: ig ? null : l.sender ?? null,
    actingSender: ig ? null : acting,
    blocked: ready && !ig ? blockedFor(l, acting) : null,
  };
}

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; status?: string; research?: string; type?: string; p?: string; ch?: string }>;
}) {
  const sp = await searchParams;
  const view = sp.view === 'all' ? 'all' : 'due';
  const jar = await cookies();
  // Which profile is working (tab). Remembered in a cookie so a setter stays on their own tab.
  const saved = jar.get('queue_tab')?.value;
  const pick = sp.p ?? saved;
  const qtab: QueueTab = isSender(pick) ? pick : 'li_check';
  const today = todayStr();
  const vertical = await getVertical();
  // Apps has two sections: LinkedIn (same as music) and Instagram (one shared profile). Remembered too.
  const channel: Channel = vertical === 'apps' && (sp.ch ?? jar.get('queue_ch')?.value) === 'ig' ? 'ig' : 'li';
  const ig = channel === 'ig';
  const acting = ig || qtab === 'li_check' ? null : qtab;
  const flow = flowFor(channel);
  const supabase = await createClient();

  const { data: templateRows, error: tErr } = await supabase.from('message_templates').select('*').eq('active', true);
  if (tErr) throw new Error(tErr.message);
  const templates = (templateRows ?? []) as Template[];

  // LinkedIn: connection requests sent today per profile ("Sent" clicks on warmed_up), reset at midnight
  // Bratislava time. Instagram: first DMs sent today (no limit).
  let invites: { name: string; dailyLimit: number; sent: number }[] = [];
  let igDmsToday = 0;
  if (ig) {
    const { count, error } = await supabase
      .from('activity')
      .select('id', { count: 'exact', head: true })
      .eq('channel', 'ig')
      .eq('from_status', 'ig_dm')
      .gte('created_at', dayStartUtc(today));
    if (error) throw new Error(error.message);
    igDmsToday = count ?? 0;
  } else {
    const { data: inviteRows, error: iErr } = await supabase
      .from('activity')
      .select('sender')
      .eq('from_status', 'warmed_up')
      .eq('to_status', 'connection_requested')
      .gte('created_at', dayStartUtc(today));
    if (iErr) throw new Error(iErr.message);
    invites = SENDERS.map((x) => ({ ...x, sent: (inviteRows ?? []).filter((r) => r.sender === x.name).length }));
  }

  let cards: CardProps[];
  // Due view: statuses present today with counts (in sequence order), for the status dropdown.
  let statusOptions: { status: string; count: number }[] = [];
  let held = 0;
  if (view === 'due' && ig) {
    const { data, error } = await supabase.from('ig_queue').select('*');
    if (error) throw new Error(error.message);
    const all = (data ?? [])
      .map((r) => toCard(r, null, templates, today, true, null, toApp({ app_name: r.app_name, rating_count: r.rating_count, genre: r.app_genre }), 'ig'))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    statusOptions = Object.keys(IG_FLOW)
      .map((status) => ({ status, count: all.filter((c) => c.status === status).length }))
      .filter((o) => o.count > 0 || o.status === sp.status);
    cards = sp.status ? all.filter((c) => c.status === sp.status) : all;
  } else if (view === 'due') {
    const { data, error } = await supabase.from('queue').select('*').eq('vertical', vertical);
    if (error) throw new Error(error.message);
    // Active first: inactive contacts wait while an active colleague at the company is still in play.
    const ready: HoldLead[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: page, error: rErr } = await supabase
        .from('leads')
        .select('id, company_name, status, last_li_activity, li_checked_at')
        .eq('research_status', 'ready')
        .eq('vertical', vertical)
        .range(from, from + 999);
      if (rErr) throw new Error(rErr.message);
      ready.push(...((page ?? []) as HoldLead[]));
      if (!page || page.length < 1000) break;
    }
    const mine = (data ?? []).filter((r) => inTab(r, qtab));
    const rows = mine.filter((r) => !onHold(r as HoldLead, ready));
    held = mine.length - rows.length;
    const all = rows
      .map((r) =>
        toCard(
          r,
          r.artist_id ? toArtist({ ...r, name: r.artist_name }) : null,
          templates, today, true, acting,
          toApp({ app_name: r.app_name, rating_count: r.rating_count, genre: r.app_genre }),
        ),
      )
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    statusOptions = Object.keys(FLOW)
      .map((status) => ({ status, count: all.filter((c) => c.status === status).length }))
      .filter((o) => o.count > 0 || o.status === sp.status);
    cards = sp.status ? all.filter((c) => c.status === sp.status) : all;
  } else {
    let query = supabase
      .from('leads')
      .select('*, artists(*), apps(*)')
      .eq('vertical', vertical)
      .order('created_at', { ascending: false })
      .limit(200);
    const q = (sp.q ?? '').replace(/[,()%*\\]/g, ' ').trim();
    if (q) query = query.or(`full_name.ilike.%${q}%,company_name.ilike.%${q}%`);
    if (ig) {
      // Instagram section: leads with a founder or company Instagram; status = their Instagram step.
      query = query.not('ig_status', 'is', null);
      if (sp.status) query = query.eq('ig_status', sp.status);
    } else if (sp.status) query = query.eq('status', sp.status);
    if (sp.research) query = query.eq('research_status', sp.research);
    if (sp.type && vertical === 'music') query = query.eq('company_type', sp.type);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    cards = (data ?? []).map((l) =>
      toCard(
        l, toArtist((l.artists as Row[]).find((a) => a.is_primary)), templates, today, false, acting,
        toApp((l.apps as Row[]).find((a) => a.is_primary)), channel,
      ),
    );
  }

  const keep = { p: qtab, ...(vertical === 'apps' ? { ch: channel } : {}) };
  const tab = (v: string, label: string) => (
    <Link
      href={`/queue?${new URLSearchParams({ ...(v === 'all' ? { view: 'all' } : {}), ...keep })}`}
      className={`rounded px-3 py-1.5 text-sm ${view === v ? 'bg-slate-900 text-white' : 'border border-slate-300'}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="flex flex-col gap-4">
      <RememberTab tab={qtab} channel={vertical === 'apps' ? channel : undefined} />
      {vertical === 'apps' && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">Channel:</span>
          {(['li', 'ig'] as Channel[]).map((c) => (
            <Link key={c} href={`/queue?${new URLSearchParams({ ...(view === 'all' ? { view: 'all' } : {}), p: qtab, ch: c })}`}
              className={`rounded px-3 py-1.5 ${channel === c ? 'bg-slate-900 font-semibold text-white' : 'border border-slate-300'}`}>
              {c === 'li' ? 'LinkedIn' : 'Instagram'}
            </Link>
          ))}
        </div>
      )}
      {ig ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
          Instagram DMs today: <b>{igDmsToday}</b>{' '}
          <span className="text-xs text-slate-500">(one shared Instagram profile, no daily limit)</span>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Working as:</span>
            {(['li_check', ...SENDERS.map((x) => x.name)] as QueueTab[]).map((t) => (
              <Link key={t} href={`/queue?${new URLSearchParams({ ...(view === 'all' ? { view: 'all' } : {}), ...keep, p: t })}`}
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
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {tab('due', 'Due')}
        {tab('all', 'All leads')}
        {view === 'due' && <StatusFilter key={sp.status ?? ''} value={sp.status ?? ''} options={statusOptions} hidden={keep} />}
        <span className="ml-auto text-sm text-slate-500">
          {cards.length} {view === 'due' ? 'due today' : 'leads'}
          {view === 'all' && cards.length === 200 ? ' (first 200, narrow the search)' : ''}
          {view === 'due' && held > 0 ? ` · ${held} inactive on hold (an active colleague is still in play)` : ''}
        </span>
      </div>

      {view === 'all' && (
        <form className="flex flex-wrap gap-2 text-sm">
          <input type="hidden" name="view" value="all" />
          {Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input name="q" defaultValue={sp.q} placeholder="Search name or company"
            className="min-w-56 flex-1 rounded border border-slate-300 px-3 py-1.5" />
          <select name="status" defaultValue={sp.status ?? ''} className="rounded border border-slate-300 px-2 py-1.5">
            <option value="">Any status</option>
            {Object.keys(flow).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select name="research" defaultValue={sp.research ?? ''} className="rounded border border-slate-300 px-2 py-1.5">
            <option value="">Any research status</option>
            {RESEARCH.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {vertical === 'music' && (
            <select name="type" defaultValue={sp.type ?? ''} className="rounded border border-slate-300 px-2 py-1.5">
              <option value="">Any company type</option>
              {COMPANY_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <button className="rounded bg-slate-900 px-3 py-1.5 text-white">Filter</button>
        </form>
      )}

      {cards.length === 0 && (
        <p className="text-sm text-slate-500">{view === 'due' ? 'Nothing due. Nice.' : 'No leads match.'}</p>
      )}
      {cards.map((c) => (
        <LeadCard key={`${c.channel}:${c.leadId}:${c.status}:${c.message?.templateKey}:${c.nextActionAt}`} {...c} />
      ))}
    </div>
  );
}
