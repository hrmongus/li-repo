# Spec: LinkedIn outreach CRM (Propagandistan)

Internal CRM for LinkedIn outreach to music labels and artist managers. We sell faceless TikTok
fan-page campaigns. Keep everything as simple as possible: nothing gets added beyond this spec
without asking.

**The message sequence and statuses are not final.** They are built so they can change cheaply:
the flow is one table in `lib/outreach.ts` (`FLOW`), messages are rows in `message_templates`,
and statuses are plain text in the database (no enum, no check constraint).

## How it works

1. **Upload.** A lead is one contact person at a label or management company. The LinkedIn URL
   is required (it's the dedupe key); email is optional.
2. **Research (Claude Code, `/research-leads`).** Runs locally in the user's Chrome
   (`claude --chrome`) and writes to Supabase through the MCP server in `.mcp.json`. The
   procedure is in `.claude/skills/research-leads/SKILL.md`. For each lead:
   - fill in name, title and company, from LinkedIn or elsewhere (scraping is allowed);
   - find the company's website and socials;
   - find up to 3 artists they work with, confirmed from the company's own website, socials or
     release credits;
   - enrich each artist (Spotify, Instagram, TikTok);
   - pick the best one as primary (biggest or fastest-growing);
   - double-check, then mark the lead `ready`.
3. **Outreach (setter).** The setter opens the queue and works through ready leads, best first.
   Each lead card shows the current step, a pre-filled message with a Copy button, and the
   step's buttons. The setter sends everything **manually** on LinkedIn. Nothing is ever sent
   automatically.

## Views (built in later tasks)

1. **Queue (setter).**
   - **Due** (default): ready leads due today or earlier, sorted by queue score. Each card shows
     name, title, company, the primary artist and their monthly listeners, the current status,
     the next action, the message for that step (pre-filled, editable before copying) and the
     step's buttons.
   - **All leads**: browse every lead with a search box (name or company) and filters for status
     and research status. Ready leads show the same card and buttons whatever their due date.
     This is how the setter marks things that happen on LinkedIn's schedule, such as an invite
     accepted early, a reply before the due date, or a late reply after the breakup message.
2. **Dashboard.** Counts per status, A/B stats per template (`template_stats`), and an editor for
   all templates.
3. **Upload.** CSV upload and paste-a-list of LinkedIn URLs. Dedupe on LinkedIn URL; the database
   normalizes it to `https://www.linkedin.com/in/<slug>`.
   - **CSV:** needs a LinkedIn URL column, named linkedin_url, LinkedIn, profile url or url.
   - **Optional columns, matched by name:** full_name, first_name, title, company_name,
     company_type, company_website, email, country. Other columns are ignored.
   - **First name:** if missing, it's taken from full_name ("Jane Doe" or "Doe, Jane" → Jane).
   - **Skipped and counted:** rows that aren't a profile URL (/in/…), duplicates within the upload,
     and leads already in the CRM.
   - New leads start with research_status = new, so they're in All leads but not in Due.

## Tables (only these four)

### leads (the contact person, one row per person)
| Column | Notes |
|---|---|
| full_name, first_name, title | |
| company_name | |
| company_type | `label` \| `management` \| `other` |
| company_website | |
| company_socials | text, free-form links |
| linkedin_url | required, unique, normalized on write |
| email | optional |
| country | |
| research_status | `new` \| `artists_found` \| `enriched` \| `ready` (set by Claude Code) |
| status | outreach status (below), default `to_do` |
| status_changed_at | |
| next_action_at | date; null = nothing due (waiting or final). Defaults to today |
| reply_type | the last reply received |
| notes, created_at | |

**Ready gate.** The database refuses `research_status = 'ready'` unless the lead has
`first_name`, `company_name` and a primary artist with a name, a song (next or latest release
title) and monthly listeners. The LinkedIn URL is always there because it's required.

### artists (up to 3 per lead; the database enforces the limit)
| Column | Notes |
|---|---|
| lead_id, name | |
| is_primary | at most one per lead (unique index); exactly one when the lead is ready |
| spotify_url, monthly_listeners | |
| instagram_url, instagram_followers | |
| tiktok_url, tiktok_followers | |
| latest_release_title, next_release_title, next_release_date | |
| tiktok_sound_url | |
| tiktok_sound_videos | videos using the song's official sound |
| hook_line | the lyric or section to mention in the voice note |
| samples_url | link to the sample edits made for this artist; fills `{Samples}` |
| notes, checked_at | |

### message_templates (edited in the dashboard)
| Column | Notes |
|---|---|
| key | |
| version | `A` \| `B`; unique per (key, version) |
| status | the outreach status this message is sent FROM |
| audience | `label` \| `manager` \| `release` \| null (any) |
| reply_type | for reply templates |
| title | |
| body | an invite with an empty body = connection request without a note |
| active | only active versions are served |

### activity (one row per button click)
| Column | Notes |
|---|---|
| lead_id, from_status, to_status | |
| template_key, version, text_sent | set when the click sends a message |
| reply_type | set only on "Replied" clicks |
| created_by | the signed-in user |
| created_at | |

Each click goes through the database function `record_step()`. It updates the lead and inserts
the activity row in one transaction, and fails if the lead has already moved on (double click,
or another setter got there first).

### Views
- **queue**: ready leads with `next_action_at <= today`, joined with the primary artist. Final
  and waiting statuses have `next_action_at = null`, so they never show up here.
- **template_stats**: one row per template key + version. Columns: times sent, leads sent to, and
  how many of those leads later (after the first send) got connected, replied, replied
  positively, or booked a call. Positive replies are `yes_send` and `picks_one`.

**Reading the stats.** Read each template on the outcome its own step is trying to produce:
- invite → connected
- message 1 → replied and positive replies
- follow-ups → replied
- replies → call booked

Earlier outcomes are fixed by construction: every message-1 lead is already connected, so its
"connected" column is always 0.

### Access
- Email + password sign-in. Accounts are created by hand in Supabase (Authentication → Users);
  public sign-ups are off.
- Two accounts for now: the admin (owner) and the setter. Both have the same rights: RLS lets any
  signed-in user (`authenticated`) read and write everything. "Admin" is only a label for now.
- activity.created_by shows which account clicked.

"Today" means the date in Europe/Bratislava.

## Outreach statuses

One or two buttons per step. Every click writes one activity row.

| Status | Next action shown to setter | Message (template.status) | Buttons → next status (next due) |
|---|---|---|---|
| to_do | Warm up: view profile, follow company, like or comment on a recent post | – | Done → warmed_up (+2 days) |
| warmed_up | Send connection request | invite_* | Sent → connection_requested (+21) |
| connection_requested | Wait. If due (21 days, not accepted): withdraw the invite | – | Accepted → connected (today) · Withdrawn → **not_accepted** |
| connected | Send message 1 | msg1_* | Sent → message_1_sent (+3) |
| message_1_sent | Voice note (script shown) | voice | Sent → follow_up_1_sent (+4) |
| follow_up_1_sent | Send follow-up (samples anyway) | followup_samples | Sent → follow_up_2_sent (+7) |
| follow_up_2_sent | Send breakup message | breakup | Sent → **no_reply** |
| replied | Answer using the suggested reply for their reply type | reply_* | Sent samples → samples_sent (+3) · Reply sent → reply_sent (+4) · Call booked → call_booked · Lost → **lost** |
| reply_sent | Waiting for their answer. If due: short follow-up (written by hand) or close | – (free text) | Followed up → reply_sent (+4) · Call booked → call_booked · Lost → **lost** |
| samples_sent | Nudge: "which one would you pick?" | samples_nudge | Sent → samples_nudged (+7) |
| samples_nudged | Waiting. If due and no answer: close | – | Call booked → call_booked · Lost → **lost** · No reply → **no_reply** |
| call_booked | Have the call | – | Won → **won** · Lost → **lost** |

- **Final statuses:** `no_reply`, `not_accepted`, `won`, `lost`. Final and waiting statuses have
  no due date.
- **"Replied" button.** Available on connected, message_1_sent, follow_up_1_sent,
  follow_up_2_sent, replied, reply_sent, samples_sent, samples_nudged and no_reply (a late
  answer to the breakup message). It asks for the reply type in a dropdown, sets
  `status = replied`, makes the lead due today, stores the reply type, and shows the matching
  reply template.
- **Reply types:** yes_send, what_is_this, send_info, how_much, bots, in_house, has_agency,
  not_now, not_interested, picks_one, not_our_vibe. Every type, including `not_now` and
  `not_interested`, gets its reply template and then the normal buttons. Nothing is closed
  automatically.
- **Logging.** Clicks that send a message store template_key, version and the final text
  (after the setter's edits). Free-text follow-ups store the text with no template_key.

## Audience (which template family to use)
- `release` if the primary artist's next_release_date is 14–56 days away (inclusive)
- else `manager` if company_type = management
- else `label`

**Template choice.** Candidates are active templates whose `status` is the lead's status and
whose `reply_type` (if set) is the lead's reply_type. An exact audience match wins over an
any-audience template (`audience = null`).

## A/B
- Each template key can have an A and a B version. Only active versions are served. If only one
  version is active, every lead gets it.
- The version for a given lead and template key is a deterministic hash of
  (lead_id + template_key). That keeps it stable on reload and splits about 50/50,
  independently for each key.

## Queue score (higher first; one function: `queueScore` in lib/outreach.ts)
- replied leads always on top (+1000)
- primary artist monthly listeners: 100k+ = 30, 20k–100k = 20, under 20k = 10
- release 14–56 days away: +20
- tiktok_sound_videos known: +5
- overdue: +2 per day, max +10

## Placeholders
`{First} {Company} {Artist} {Song} {date} {N} {hookLine} {Samples}`
- **Song** = next_release_title, else latest_release_title.
- **date** = next_release_date, formatted like "14 Nov".
- **N** = tiktok_sound_videos with thousands separators (12,400).
- **Samples** = the primary artist's samples_url.
- **Copy is disabled** while the message still contains an unfilled `{placeholder}` or a
  `[square-bracket note]`. A warning shows until the setter edits the text.
- **`[DECK LINK]` and `[CALENDAR LINK]`** are the same for everyone. Replace them once in the
  dashboard editor.
- **Invite notes** must be ≤ 200 characters (`INVITE_NOTE_LIMIT`). The character count is shown,
  and Copy is disabled while the note is over the limit.

## Templates (seeded in supabase/seed.sql)

There are 21 keys and 27 rows. The three invite keys and three message-1 keys each have a B
version: for invites, B is an empty body (no note). See `supabase/seed.sql` for the exact text.

| Key | Sent from | Audience / reply type |
|---|---|---|
| invite_label, invite_release, invite_manager (A, B = no note) | warmed_up | label / release / manager |
| msg1_label, msg1_release, msg1_manager (A, B) | connected | label / release / manager |
| voice | message_1_sent | any |
| followup_samples | follow_up_1_sent | any |
| breakup | follow_up_2_sent | any |
| samples_nudge | samples_sent | any |
| reply_yes_send … reply_not_our_vibe (11 keys) | replied | one per reply type |

## Rules
- Never auto-send anything on LinkedIn: invites, messages, likes, follows and withdrawals are
  always done by hand. Reading or scraping LinkedIn profile data for research is allowed.
- Never guess an artist. Only artists confirmed from the company's own website, socials or
  release credits get added.
- A lead reaches the queue only when research_status = ready. That requires a LinkedIn URL,
  first name, company, and a primary artist with a name, a song and monthly listeners.
- Every button click is logged in activity with the template version, so the A/B stats stay
  clean.
- Templates live in the database and are edited in the dashboard.
- Keep it simple. Ask before adding anything not in this spec.
