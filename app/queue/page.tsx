import Link from 'next/link';
import {
  FLOW,
  pickTemplate,
  queueScore,
  renderMessage,
  step,
  todayStr,
  type Artist,
  type Lead,
  type Template,
} from '@/lib/outreach';
import { createClient } from '@/lib/supabase/server';
import { LeadCard, type CardProps } from './LeadCard';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const RESEARCH = ['new', 'artists_found', 'enriched', 'ready'];

function toArtist(a: Row | null | undefined): Artist | null {
  if (!a) return null;
  return {
    name: a.name,
    monthly_listeners: a.monthly_listeners,
    latest_release_title: a.latest_release_title,
    next_release_title: a.next_release_title,
    next_release_date: a.next_release_date,
    tiktok_sound_videos: a.tiktok_sound_videos,
    hook_line: a.hook_line,
    samples_url: a.samples_url,
  };
}

function toCard(l: Row, artist: Artist | null, templates: Template[], today: string, withScore: boolean): CardProps {
  const lead = l as Lead;
  const ready = l.research_status === 'ready' && artist !== null && FLOW[l.status] !== undefined;
  const s = ready ? step(l.status) : null;
  let message: CardProps['message'] = null;
  if (s && s.buttons.some((b) => b.sends)) {
    const t = pickTemplate(templates, lead, artist, today);
    message = t
      ? { text: renderMessage(t, lead, artist).text, templateKey: t.key, version: t.version, templateTitle: t.title }
      : { text: '', templateKey: null, version: null, templateTitle: null };
  }
  const extra: string[] = [];
  if (artist?.next_release_title) {
    extra.push(`next: ${artist.next_release_title}${artist.next_release_date ? ` (${artist.next_release_date})` : ''}`);
  } else if (artist?.latest_release_title) extra.push(`latest: ${artist.latest_release_title}`);
  if (artist?.tiktok_sound_videos != null) extra.push(`${artist.tiktok_sound_videos.toLocaleString('en-US')} TikTok videos`);

  return {
    leadId: l.id,
    name: l.full_name || l.first_name || l.linkedin_url.replace('https://www.linkedin.com/in/', ''),
    title: l.title,
    company: l.company_name,
    linkedinUrl: l.linkedin_url,
    researchStatus: l.research_status,
    status: l.status,
    nextActionAt: l.next_action_at,
    replyType: l.reply_type,
    score: withScore && ready ? queueScore(lead, artist, today) : null,
    artist: artist ? { name: artist.name, listeners: artist.monthly_listeners, extra } : null,
    ready,
    action: s?.action ?? '',
    buttons: s?.buttons ?? [],
    canReply: s?.canReply ?? false,
    message,
    noteLimit: s?.noteLimit ?? null,
  };
}

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; status?: string; research?: string }>;
}) {
  const sp = await searchParams;
  const view = sp.view === 'all' ? 'all' : 'due';
  const today = todayStr();
  const supabase = await createClient();

  const { data: templateRows, error: tErr } = await supabase.from('message_templates').select('*').eq('active', true);
  if (tErr) throw new Error(tErr.message);
  const templates = (templateRows ?? []) as Template[];

  let cards: CardProps[];
  if (view === 'due') {
    const { data, error } = await supabase.from('queue').select('*');
    if (error) throw new Error(error.message);
    cards = (data ?? [])
      .map((r) => toCard(r, toArtist({ ...r, name: r.artist_name }), templates, today, true))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  } else {
    let query = supabase.from('leads').select('*, artists(*)').order('created_at', { ascending: false }).limit(200);
    const q = (sp.q ?? '').replace(/[,()%*\\]/g, ' ').trim();
    if (q) query = query.or(`full_name.ilike.%${q}%,company_name.ilike.%${q}%`);
    if (sp.status) query = query.eq('status', sp.status);
    if (sp.research) query = query.eq('research_status', sp.research);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    cards = (data ?? []).map((l) =>
      toCard(l, toArtist((l.artists as Row[]).find((a) => a.is_primary)), templates, today, false),
    );
  }

  const tab = (v: string, label: string) => (
    <Link
      href={v === 'all' ? '/queue?view=all' : '/queue'}
      className={`rounded px-3 py-1.5 text-sm ${view === v ? 'bg-slate-900 text-white' : 'border border-slate-300'}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {tab('due', 'Due')}
        {tab('all', 'All leads')}
        <span className="ml-auto text-sm text-slate-500">
          {cards.length} {view === 'due' ? 'due today' : 'leads'}
          {view === 'all' && cards.length === 200 ? ' (first 200, narrow the search)' : ''}
        </span>
      </div>

      {view === 'all' && (
        <form className="flex flex-wrap gap-2 text-sm">
          <input type="hidden" name="view" value="all" />
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
