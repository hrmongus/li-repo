// Outreach business logic: status flow, due dates, audience, template choice,
// A/B version assignment, template rendering and queue score.
// Pure functions only (no database calls), so the UI and server actions share them
// and they are easy to test. See docs/SPEC.md.
//
// The sequence is expected to change. To change it, edit FLOW below and the
// message_templates rows (template.status = the status a message is sent FROM).
// Statuses are plain text in the database, so no migration is needed, except for the
// few status names that the template_stats view hard-codes (see the migration).

// ---------- Types ----------

export type Version = 'A' | 'B';
export type Audience = 'label' | 'manager' | 'release';
export type CompanyType = 'label' | 'management' | 'other';
export type ResearchStatus = 'new' | 'artists_found' | 'enriched' | 'ready';

/** Dates are 'YYYY-MM-DD' strings (Postgres `date`). */
export type DateStr = string;

export interface Lead {
  id: string;
  first_name: string | null;
  company_name: string | null;
  company_type: CompanyType | null;
  status: string;
  next_action_at: DateStr | null;
  reply_type: string | null;
}

export interface Artist {
  name: string;
  monthly_listeners: number | null;
  latest_release_title: string | null;
  next_release_title: string | null;
  next_release_date: DateStr | null;
  tiktok_sound_videos: number | null;
  hook_line: string | null;
  samples_url: string | null;
}

export interface Template {
  key: string;
  version: Version;
  status: string;
  audience: Audience | null;
  reply_type: string | null;
  title: string;
  body: string;
  active: boolean;
}

// ---------- Settings ----------

export const TIME_ZONE = 'Europe/Bratislava';
export const INVITE_NOTE_LIMIT = 200; // LinkedIn connection-note limit (characters)
export const RELEASE_WINDOW = { minDays: 14, maxDays: 56 };
export const POSITIVE_REPLY_TYPES = ['yes_send', 'picks_one'];

export const REPLY_TYPES = [
  'yes_send',
  'what_is_this',
  'send_info',
  'how_much',
  'bots',
  'in_house',
  'has_agency',
  'not_now',
  'not_interested',
  'picks_one',
  'not_our_vibe',
] as const;
export type ReplyType = (typeof REPLY_TYPES)[number];

// ---------- Status flow ----------

export interface Button {
  id: string;
  label: string;
  to: string;
  /** Days from today until the next action. 0 = due today, null = no due date (waiting or final). */
  dueInDays: number | null;
  /** true = this click sends the step's message: activity stores template_key, version, text. */
  sends?: boolean;
}

export interface Step {
  /** What the setter should do now. */
  action: string;
  buttons: Button[];
  /** Show the "Replied" button on this status. */
  canReply: boolean;
  /** Character limit for the message on this step (invite notes). */
  noteLimit?: number;
}

const won: Button = { id: 'won', label: 'Won', to: 'won', dueInDays: null };
const lost: Button = { id: 'lost', label: 'Lost', to: 'lost', dueInDays: null };
const callBooked: Button = { id: 'call_booked', label: 'Call booked', to: 'call_booked', dueInDays: null };

export const FLOW: Record<string, Step> = {
  to_do: {
    action: 'Warm up: view profile, follow company, like or comment on a recent post',
    buttons: [{ id: 'done', label: 'Done', to: 'warmed_up', dueInDays: 2 }],
    canReply: false,
  },
  warmed_up: {
    action: 'Send connection request',
    buttons: [{ id: 'sent', label: 'Sent', to: 'connection_requested', dueInDays: 21, sends: true }],
    canReply: false,
    noteLimit: INVITE_NOTE_LIMIT,
  },
  connection_requested: {
    action: 'Wait. If due (21 days, not accepted): withdraw the invite',
    buttons: [
      { id: 'accepted', label: 'Accepted', to: 'connected', dueInDays: 0 },
      { id: 'withdrawn', label: 'Withdrawn', to: 'not_accepted', dueInDays: null },
    ],
    canReply: false,
  },
  connected: {
    action: 'Send message 1',
    buttons: [{ id: 'sent', label: 'Sent', to: 'message_1_sent', dueInDays: 3, sends: true }],
    canReply: true,
  },
  message_1_sent: {
    action: 'Send voice note (script below)',
    buttons: [{ id: 'sent', label: 'Sent', to: 'follow_up_1_sent', dueInDays: 4, sends: true }],
    canReply: true,
  },
  follow_up_1_sent: {
    action: 'Send follow-up (samples anyway)',
    buttons: [{ id: 'sent', label: 'Sent', to: 'follow_up_2_sent', dueInDays: 7, sends: true }],
    canReply: true,
  },
  follow_up_2_sent: {
    action: 'Send breakup message',
    buttons: [{ id: 'sent', label: 'Sent', to: 'no_reply', dueInDays: null, sends: true }],
    canReply: true,
  },
  replied: {
    action: 'Answer using the suggested reply for their reply type',
    buttons: [
      { id: 'sent_samples', label: 'Sent samples', to: 'samples_sent', dueInDays: 3, sends: true },
      { id: 'reply_sent', label: 'Reply sent', to: 'reply_sent', dueInDays: 4, sends: true },
      callBooked,
      lost,
    ],
    canReply: true,
  },
  reply_sent: {
    action: 'Waiting for their answer. If due: send a short follow-up (write it yourself) or close',
    buttons: [
      { id: 'followed_up', label: 'Followed up', to: 'reply_sent', dueInDays: 4, sends: true },
      callBooked,
      lost,
    ],
    canReply: true,
  },
  samples_sent: {
    action: 'Nudge: "which one would you pick?"',
    buttons: [{ id: 'sent', label: 'Sent', to: 'samples_nudged', dueInDays: 7, sends: true }],
    canReply: true,
  },
  samples_nudged: {
    action: 'Waiting. If due and no answer: close as no reply',
    buttons: [callBooked, lost, { id: 'no_reply', label: 'No reply', to: 'no_reply', dueInDays: null }],
    canReply: true,
  },
  call_booked: {
    action: 'Have the call',
    buttons: [won, lost],
    canReply: false,
  },
  // Final statuses. no_reply still allows "Replied" (a late answer to the breakup).
  no_reply: { action: 'Closed: no reply', buttons: [], canReply: true },
  not_accepted: { action: 'Closed: invite not accepted', buttons: [], canReply: false },
  won: { action: 'Closed: won', buttons: [], canReply: false },
  lost: { action: 'Closed: lost', buttons: [], canReply: false },
};

export const FINAL_STATUSES = ['no_reply', 'not_accepted', 'won', 'lost'];

export function step(status: string): Step {
  const s = FLOW[status];
  if (!s) throw new Error(`Unknown status: ${status}`);
  return s;
}

/** The lead update a click produces. Pass it to the record_step() database function. */
export interface Transition {
  from_status: string;
  to_status: string;
  next_action_at: DateStr | null;
  reply_type: string | null;
}

export function clickButton(status: string, buttonId: string, today: DateStr): Transition {
  const button = step(status).buttons.find((b) => b.id === buttonId);
  if (!button) throw new Error(`No button "${buttonId}" on status "${status}"`);
  return {
    from_status: status,
    to_status: button.to,
    next_action_at: button.dueInDays === null ? null : addDays(today, button.dueInDays),
    reply_type: null,
  };
}

/** The "Replied" button: status = replied, due today, store the reply type. */
export function clickReplied(status: string, replyType: ReplyType, today: DateStr): Transition {
  if (!step(status).canReply) throw new Error(`"Replied" is not available on status "${status}"`);
  if (!REPLY_TYPES.includes(replyType)) throw new Error(`Unknown reply type: ${replyType}`);
  return { from_status: status, to_status: 'replied', next_action_at: today, reply_type: replyType };
}

// ---------- Dates ----------

/** Today's date in the team's time zone, as 'YYYY-MM-DD'. */
export function todayStr(now: Date = new Date()): DateStr {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(now);
}

function toUtc(d: DateStr): number {
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, day);
}

export function addDays(d: DateStr, days: number): DateStr {
  return new Date(toUtc(d) + days * 86_400_000).toISOString().slice(0, 10);
}

/** b - a in whole days. */
export function daysBetween(a: DateStr, b: DateStr): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-11-14' -> '14 Nov' */
export function formatShortDate(d: DateStr): string {
  const [, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[m - 1]}`;
}

// ---------- Audience ----------

export function isReleaseSoon(artist: Artist | null, today: DateStr): boolean {
  if (!artist?.next_release_date) return false;
  const days = daysBetween(today, artist.next_release_date);
  return days >= RELEASE_WINDOW.minDays && days <= RELEASE_WINDOW.maxDays;
}

export function audienceFor(lead: Lead, artist: Artist | null, today: DateStr): Audience {
  if (isReleaseSoon(artist, today)) return 'release';
  if (lead.company_type === 'management') return 'manager';
  return 'label';
}

// ---------- A/B ----------

/**
 * FNV-1a 32-bit hash with a murmur3 finalizer. Stable across reloads, browsers and servers.
 * The finalizer matters: plain FNV-1a's lowest bit is just the XOR of the input characters'
 * lowest bits, so `% 2` would correlate a lead's versions across template keys.
 */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Version for this lead and template key: a deterministic hash of (lead_id + template_key),
 * about 50/50. If only one version is active, that one is used. null = no active version.
 */
export function pickVersion(leadId: string, templateKey: string, activeVersions: Version[]): Version | null {
  const hasA = activeVersions.includes('A');
  const hasB = activeVersions.includes('B');
  if (hasA && hasB) return hash32(`${leadId}:${templateKey}`) % 2 === 0 ? 'A' : 'B';
  if (hasA) return 'A';
  if (hasB) return 'B';
  return null;
}

/**
 * The template to show for this lead's current step, or null if the step has no message.
 * Matches template.status = lead.status. For templates with a reply_type, it must equal the
 * lead's reply_type. An exact audience match beats a template for any audience (null).
 */
export function pickTemplate(templates: Template[], lead: Lead, artist: Artist | null, today: DateStr): Template | null {
  const audience = audienceFor(lead, artist, today);
  const candidates = templates.filter(
    (t) =>
      t.active &&
      t.status === lead.status &&
      (t.reply_type === null || t.reply_type === lead.reply_type) &&
      (t.audience === null || t.audience === audience),
  );
  if (candidates.length === 0) return null;
  const exact = candidates.filter((t) => t.audience === audience);
  const pool = exact.length > 0 ? exact : candidates;
  const key = pool.map((t) => t.key).sort()[0];
  const versions = pool.filter((t) => t.key === key);
  const version = pickVersion(lead.id, key, versions.map((t) => t.version));
  return versions.find((t) => t.version === version) ?? null;
}

// ---------- Rendering ----------

export function placeholderValues(lead: Lead, artist: Artist | null): Record<string, string | null> {
  return {
    First: lead.first_name,
    Company: lead.company_name,
    Artist: artist?.name ?? null,
    Song: artist?.next_release_title || artist?.latest_release_title || null,
    date: artist?.next_release_date ? formatShortDate(artist.next_release_date) : null,
    N: artist?.tiktok_sound_videos != null ? artist.tiktok_sound_videos.toLocaleString('en-US') : null,
    hookLine: artist?.hook_line ?? null,
    Samples: artist?.samples_url ?? null,
  };
}

/** Fill placeholders. Unknown or empty placeholders stay in the text as {name}. */
export function fillTemplate(body: string, values: Record<string, string | null>): string {
  return body.replace(/\{(\w+)\}/g, (match, name: string) => values[name] || match);
}

export interface MessageCheck {
  length: number;
  limit: number | null;
  /** Problems that block the Copy button until the setter edits the text. */
  problems: string[];
  canCopy: boolean;
}

/** Check the (possibly edited) text before Copy. Run it on every edit. */
export function checkMessage(text: string, limit: number | null = null): MessageCheck {
  const problems: string[] = [];
  const unfilled = text.match(/\{\w+\}/g);
  if (unfilled) problems.push(`Unfilled placeholder: ${[...new Set(unfilled)].join(', ')}`);
  const notes = text.match(/\[[^\]]*\]/g);
  if (notes) problems.push(`Note to replace: ${[...new Set(notes)].join(', ')}`);
  if (limit !== null && text.length > limit) problems.push(`Too long: ${text.length}/${limit} characters`);
  return { length: text.length, limit, problems, canCopy: problems.length === 0 };
}

/** Pre-filled message for the lead's current step. */
export function renderMessage(template: Template, lead: Lead, artist: Artist | null) {
  const text = fillTemplate(template.body, placeholderValues(lead, artist));
  return { text, check: checkMessage(text, step(lead.status).noteLimit ?? null) };
}

// ---------- Queue score ----------

/** Higher = shown first. All tuning happens here. */
export function queueScore(lead: Pick<Lead, 'status' | 'next_action_at'>, artist: Artist | null, today: DateStr): number {
  let score = 0;
  if (lead.status === 'replied') score += 1000; // replied leads always on top

  const listeners = artist?.monthly_listeners ?? 0;
  if (listeners >= 100_000) score += 30;
  else if (listeners >= 20_000) score += 20;
  else score += 10;

  if (isReleaseSoon(artist, today)) score += 20;
  if (artist?.tiktok_sound_videos != null) score += 5;

  if (lead.next_action_at) {
    const overdueDays = daysBetween(lead.next_action_at, today);
    if (overdueDays > 0) score += Math.min(overdueDays * 2, 10);
  }
  return score;
}
