// Outreach business logic: status flow, due dates, message type, template choice,
// A/B version assignment, template rendering and queue score.
// Pure functions only (no database calls), so the UI and server actions share them
// and they are easy to test. See docs/SPEC.md.
//
// To change the sequence, edit FLOW below and the message_templates rows
// (template.status = the status a message is sent FROM). Statuses are plain text in the
// database, so no migration is needed, except for the status names the template_stats and
// queue views hard-code (connected, replied, call_booked and the final statuses).

// ---------- Types ----------

export type Version = 'A' | 'B';
export type CompanyType = 'label' | 'management' | 'agency' | 'distributor' | 'other';
/** The three message families. Follows company_type; distributors and "other" get none. */
export type MessageType = 'label' | 'management' | 'agency';
export type ResearchStatus = 'new' | 'artists_found' | 'enriched' | 'ready' | 'disqualified';

/** Dates are 'YYYY-MM-DD' strings (Postgres `date`). */
export type DateStr = string;

export interface Lead {
  id: string;
  first_name: string | null;
  company_name: string | null;
  company_type: CompanyType | null;
  status: string;
  next_action_at: DateStr | null;
  top_artist_listeners: number | null;
  /** Date of the lead's last LinkedIn post, repost or comment. null = none found (or not checked). */
  last_li_activity: DateStr | null;
  /** When research checked LinkedIn activity. null = not checked yet. */
  li_checked_at: DateStr | null;
}

export interface Artist {
  name: string;
  monthly_listeners: number | null;
  latest_release_title: string | null;
  top_cities: string | null;
}

export interface Template {
  key: string;
  version: Version;
  status: string;
  audience: MessageType;
  title: string;
  body: string;
  active: boolean;
}

// ---------- Settings ----------

export const TIME_ZONE = 'Europe/Bratislava';
export const INVITE_NOTE_LIMIT = 200; // LinkedIn connection-note limit (characters)
export const DISQUALIFY_REASONS = [
  'major',
  'roster_too_big',
  'roster_too_small',
  'company_too_big',
  'distributor',
  'competitor',
] as const;

// ---------- Status flow ----------

export interface Button {
  id: string;
  label: string;
  to: string;
  /** Days from today until the next action. 0 = due today, null = no due date (waiting or final). */
  dueInDays: number | null;
  /** true = this click sends the step's message: activity stores template_key, version, text. */
  sends?: boolean;
  /** true = "Plan sent": status stays, leads.plan_sent_at is set. */
  planSent?: boolean;
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

const lost: Button = { id: 'lost', label: 'Lost', to: 'lost', dueInDays: null };

export const FLOW: Record<string, Step> = {
  to_do: {
    action: 'Warm up: view profile and follow the company. If they posted recently, like or comment on it',
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
    action: 'Wait. If due: withdraw the invite',
    buttons: [
      { id: 'accepted', label: 'Accepted', to: 'connected', dueInDays: 0 },
      { id: 'withdrawn', label: 'Withdrawn', to: 'not_accepted', dueInDays: null },
    ],
    canReply: false,
  },
  connected: {
    action: 'Send message 1',
    buttons: [{ id: 'sent', label: 'Sent', to: 'message_1_sent', dueInDays: 4, sends: true }],
    canReply: true,
  },
  message_1_sent: {
    action: 'Send follow-up nudge',
    buttons: [{ id: 'sent', label: 'Sent', to: 'follow_up_sent', dueInDays: 7, sends: true }],
    canReply: true,
  },
  follow_up_sent: {
    action: 'Send breakup message',
    buttons: [{ id: 'sent', label: 'Sent', to: 'breakup_sent', dueInDays: 7, sends: true }],
    canReply: true,
  },
  breakup_sent: {
    action: 'No answer',
    buttons: [{ id: 'no_reply', label: 'No reply', to: 'no_reply', dueInDays: null }],
    canReply: true,
  },
  replied: {
    action: 'Answer by hand. Goal: send the plan + 3 edits, then book a call',
    buttons: [
      { id: 'plan_sent', label: 'Plan sent', to: 'replied', dueInDays: 3, planSent: true },
      { id: 'call_booked', label: 'Call booked', to: 'call_booked', dueInDays: null },
      lost,
    ],
    canReply: false,
  },
  call_booked: {
    action: 'Have the call',
    buttons: [{ id: 'won', label: 'Won', to: 'won', dueInDays: null }, lost],
    canReply: false,
  },
  // Final statuses. no_reply still allows "Replied" (a late answer to the breakup).
  no_reply: { action: 'Closed: no reply', buttons: [], canReply: true },
  not_accepted: { action: 'Closed: invite not accepted', buttons: [], canReply: false },
  won: { action: 'Closed: won', buttons: [], canReply: false },
  lost: { action: 'Closed: lost', buttons: [], canReply: false },
};

export const FINAL_STATUSES = ['no_reply', 'not_accepted', 'won', 'lost'];

/**
 * The statuses you pass through by always clicking the first (main) button, starting at `start`.
 * Used to draw the sequence: pathFrom('to_do') is the main path.
 */
export function pathFrom(start: string): string[] {
  const path: string[] = [];
  let s: string | undefined = start;
  while (s && FLOW[s] && !path.includes(s)) {
    path.push(s);
    s = FLOW[s].buttons[0]?.to;
  }
  return path;
}

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
  plan_sent: boolean;
}

export function clickButton(status: string, buttonId: string, today: DateStr): Transition {
  const button = step(status).buttons.find((b) => b.id === buttonId);
  if (!button) throw new Error(`No button "${buttonId}" on status "${status}"`);
  return {
    from_status: status,
    to_status: button.to,
    next_action_at: button.dueInDays === null ? null : addDays(today, button.dueInDays),
    plan_sent: button.planSent === true,
  };
}

/** The "Replied" button: stops the sequence, status = replied, due today. */
export function clickReplied(status: string, today: DateStr): Transition {
  if (!step(status).canReply) throw new Error(`"Replied" is not available on status "${status}"`);
  return { from_status: status, to_status: 'replied', next_action_at: today, plan_sent: false };
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

// ---------- Message type ----------

/** label → label, management → management, agency → agency; anything else has no messages. */
export function messageType(companyType: CompanyType | null): MessageType | null {
  return companyType === 'label' || companyType === 'management' || companyType === 'agency' ? companyType : null;
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

/** The template for this lead's current step: same status, same message type. null = none. */
export function pickTemplate(templates: Template[], lead: Lead): Template | null {
  const type = messageType(lead.company_type);
  if (!type) return null;
  const candidates = templates.filter((t) => t.active && t.status === lead.status && t.audience === type);
  if (candidates.length === 0) return null;
  const key = candidates.map((t) => t.key).sort()[0];
  const versions = candidates.filter((t) => t.key === key);
  const version = pickVersion(lead.id, key, versions.map((t) => t.version));
  return versions.find((t) => t.version === version) ?? null;
}

// ---------- Rendering ----------

export const PLACEHOLDERS = ['First', 'Company', 'Artist', 'Song', 'City'];

export function placeholderValues(lead: Lead, artist: Artist | null): Record<string, string | null> {
  return {
    First: lead.first_name,
    Company: lead.company_name,
    Artist: artist?.name ?? null,
    Song: artist?.latest_release_title ?? null,
    City: artist?.top_cities?.split(',')[0]?.trim() || null,
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

/**
 * LinkedIn activity (last post, repost or comment). Any activity beats none; never posting is
 * by far the lowest. Not checked yet = neutral.
 */
export function activityPoints(lead: Pick<Lead, 'last_li_activity' | 'li_checked_at'>, today: DateStr): number {
  if (!lead.li_checked_at) return 0; // not checked yet
  if (!lead.last_li_activity) return -20; // checked: never posted, reposted or commented
  const days = daysBetween(lead.last_li_activity, today);
  if (days <= 30) return 10;
  if (days <= 90) return 5;
  return 0; // older activity: still better than none
}

/** Higher = shown first. All tuning happens here. */
export function queueScore(
  lead: Pick<Lead, 'status' | 'next_action_at' | 'company_type' | 'top_artist_listeners' | 'last_li_activity' | 'li_checked_at'>,
  today: DateStr,
): number {
  let score = 0;
  if (lead.status === 'replied') score += 1000; // replied leads always on top

  if (lead.company_type === 'agency') {
    score += 15;
  } else {
    const top = lead.top_artist_listeners ?? 0;
    if (top >= 1_000_000) score += 30; // 1M–4M (over 4M is disqualified)
    else if (top >= 100_000) score += 25;
    else if (top >= 10_000) score += 15; // under 10k is disqualified
  }

  score += activityPoints(lead, today);

  if (lead.next_action_at) {
    const overdueDays = daysBetween(lead.next_action_at, today);
    if (overdueDays > 0) score += Math.min(overdueDays * 2, 10);
  }
  return score;
}
