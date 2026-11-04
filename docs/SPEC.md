# Spec: LinkedIn outreach CRM (Propagandistan)

Internal CRM for LinkedIn outreach to music labels, artist managers and agencies. We sell faceless
TikTok fan-page campaigns. Keep everything as simple as possible: nothing gets added beyond this
spec without asking.

The sequence lives in one table in `lib/outreach.ts` (`FLOW`), messages are rows in
`message_templates`, and outreach statuses are plain text in the database.

## How it works

1. **Upload.** A lead is one contact person at a label, management company or agency (distributors
   come in too, but are disqualified). Artists are never leads. The LinkedIn URL is the dedupe key
   when present; without it, leads are deduped on name + company. Email is optional.
2. **Research (Claude Code, `/research-leads`).** Runs locally in the user's Chrome and writes to
   Supabase. The procedure is in `.claude/skills/research-leads/SKILL.md`. Cheapest checks first,
   so bad leads stop early (see "Research and disqualification").
3. **Outreach (setter).** The setter works through the queue, best first. Each card shows the
   current step, a pre-filled message with a Copy button, and the step's buttons. Everything is
   sent **by hand** on LinkedIn. Nothing is automated on LinkedIn.

## Research and disqualification

Order (stop at the first failure; a disqualified lead keeps its reason):
1. **Classify `company_type`:** label, management, agency, distributor or other. `other` never
   becomes ready; research reclassifies it.
2. **Distributor** → disqualify (`distributor`).
3. **Major** → disqualify (`major`).
4. **Agency:** check its services (website, LinkedIn). If it sells something similar →
   disqualify (`competitor`). Otherwise go to the staff check (8), then ready. Never research
   artists for agencies; their artist fields stay empty.
5. **Label / management, roster:** find the roster on the company's website and socials.
   Record the **biggest** artist on the roster (whatever its size) and set
   `top_artist_listeners`. Then apply `roster_too_big` / `roster_too_small`.
6. **Artists:** add up to 3 roster artists, confirmed from the company's own website, socials or
   release credits (never guessed). Primary = the biggest.
   - **Primary artist fields:** Spotify URL, monthly listeners, latest song title, genre, top
     cities (from the Spotify artist page).
   - **If easy to find:** Instagram and TikTok URLs and followers.
7. **Company name:** one consistent `company_name` per company. A parenthetical distributor or
   parent (e.g. "(EMPIRE)") goes in notes, not in the name.
8. **Staff count, last:** only for leads that passed the checks above. Use the company website
   or other public sources first; visit the LinkedIn company page only if nothing else works, and
   never from the outreach account. Check once per company and copy it to all its contacts.
   Over 50 → disqualify (`company_too_big`).
9. **Ready:** LinkedIn URL, first name and company; label and management leads also need a
   primary artist with a name, song and monthly listeners. The database enforces this.

| disqualify_reason | Rule |
|---|---|
| major | Company is owned by Universal, Sony or Warner, including their imprints (Jive, Columbia, Atlantic, Interscope, Republic, Capitol, RCA, Island, Def Jam, Epic, Parlophone, Elektra, etc.). Check the parent company, not just the name. |
| roster_too_big | Any artist on the roster has more than 4,000,000 monthly listeners. Never re-pick a smaller artist to get around this. |
| roster_too_small | Labels and management only: no artist on the roster has 10,000+ monthly listeners. |
| company_too_big | More than 50 staff. |
| distributor | Distributors and distribution platforms (AWAL, UnitedMasters, DistroKid, etc.). A label only distributed by one is fine. All leads with company_type = distributor are disqualified. |
| competitor | Agencies that already sell TikTok fan pages, TikTok/Reels seeding, UGC or creator campaigns. |

Disqualified leads stay in the database (the rules may relax later) and never reach the queue.

## Views

1. **Queue (setter).**
   - **Due** (default): ready leads due today or overdue, within the company cap, not in a
     final status, sorted by queue score.
   - **Each card shows:** name, title, company, a message-type badge (label / management /
     agency), the primary artist and listeners (label and management), the current status, the
     next action, the message for that step (pre-filled, editable before copying), the buttons,
     and a link to `plan_url` when set.
   - **All leads:** search by name or company, filter by status, research status and company
     type. Ready leads show the same card and buttons whatever their due date.
2. **Dashboard.**
   - Counts per status, plus disqualified counts per reason.
   - The sequence with the template editor: 4 message steps × 3 message types.
   - A/B stats per template version, per step and type, plus an all-types total per step.
3. **Upload.** CSV upload and a pasted list of LinkedIn URLs.
   - **CSV columns recognized:** LinkedIn URL (linkedin_url, LinkedIn, LinkedIn profile, url),
     full name, first name, title, company, `company_type` (label, management, agency,
     distributor or other; a "segment" column works too), website, company LinkedIn (into
     company_socials), email, country. Every other non-empty column goes into notes.
   - **Rows without a LinkedIn profile** are imported when they name a person. Shared mailboxes
     are skipped. New leads start with research_status = new.

## Tables (only these four)

### leads (the contact person, one row per person)
| Column | Notes |
|---|---|
| full_name, first_name, title | |
| company_name | one consistent name per company |
| company_type | `label` \| `management` \| `agency` \| `distributor` \| `other` |
| company_website, company_socials | |
| company_staff | int, staff count (checked once per company) |
| top_artist_listeners | int, monthly listeners of the biggest artist on the roster |
| linkedin_url | unique when present, normalized on write; required for ready |
| email, country | |
| research_status | `new` \| `artists_found` \| `enriched` \| `ready` \| `disqualified` |
| disqualify_reason | set exactly when research_status = disqualified (see the table above) |
| status | outreach status (below), default `to_do` |
| status_changed_at | |
| next_action_at | date; null = nothing due (waiting or final). Defaults to today |
| plan_url | optional link to the one-pager PDF (generator is a later build) |
| plan_sent_at | set by "Plan sent" |
| notes, created_at | |

### artists (up to 3 per lead; one primary = the biggest; none for agencies)
| Column | Notes |
|---|---|
| lead_id, name, is_primary | at most one primary per lead |
| spotify_url, monthly_listeners | |
| latest_release_title | fills `{Song}` |
| genre, top_cities | from the Spotify artist page; first city fills `{City}` |
| instagram_url, instagram_followers, tiktok_url, tiktok_followers | if easy to find |
| notes, checked_at | notes = roster / credit source |

### message_templates (edited in the dashboard)
| Column | Notes |
|---|---|
| key | e.g. `invite_label` |
| version | `A` \| `B`; unique per (key, version) |
| status | the outreach status this message is sent FROM |
| audience | message type: `label` \| `management` \| `agency` |
| title, body, active | an invite with an empty body = connection request without a note |

### activity (one row per button click)
lead_id, from_status, to_status, template_key, version, text_sent, created_by, created_at.
Each click goes through the database function `record_step()`, which updates the lead and
inserts the row in one transaction. Sends store template_key, version and the final text.

### Views
- **queue:** ready leads, due today or overdue, not final, within the company cap, with the
  primary artist (none for agencies).
- **template_stats:** per key + version (with message type and step): sent, and how many of
  those leads later connected, replied or booked a call.
- **lead_counts:** counts per research status, status and disqualify reason.

### Access
- Email + password sign-in. Accounts are created by hand in Supabase; public sign-ups are off.
- Admin and setter have the same rights; RLS lets any signed-in user read and write everything.

"Today" means the date in Europe/Bratislava.

## Company cap
At most **2 active contacts per company** in the queue, computed in the `queue` view (no extra
status). Companies are grouped by `company_name` (case and spaces ignored).
- **Active** = ready and not `no_reply`, `not_accepted` or `lost`. A `won` lead keeps its slot.
- **Who gets the slots:**
  1. Contacts already in the sequence (past `to_do`) keep theirs.
  2. Then by title: Founder / Owner / CEO / President / Managing Director, then Label Manager /
     General Manager, then Head of Marketing, then others.
  3. Then the oldest lead.
- **The rest stay ready but hidden.** A hidden contact shows up when one of the two reaches
  `no_reply`, `not_accepted` or `lost`.

## Outreach statuses (13)

| Status | Setter's next action | Message | Button(s) → next status (next due) |
|---|---|---|---|
| to_do | Warm up: view profile, follow company, like or comment on a recent post | – | Done → warmed_up (+2 days) |
| warmed_up | Send connection request | invite_* | Sent → connection_requested (+21) |
| connection_requested | Wait. If due: withdraw the invite | – | Accepted → connected (today) · Withdrawn → **not_accepted** |
| connected | Send message 1 | msg1_* | Sent → message_1_sent (+4) |
| message_1_sent | Send follow-up nudge | followup_* | Sent → follow_up_sent (+7) |
| follow_up_sent | Send breakup message | breakup_* | Sent → breakup_sent (+7) |
| breakup_sent | No answer | – | No reply → **no_reply** |
| replied | Answer by hand. Goal: send the plan + 3 edits, then book a call | – | Plan sent → stays replied (+3) · Call booked → call_booked · Lost → **lost** |
| call_booked | Have the call | – | Won → **won** · Lost → **lost** |

- **Final statuses:** `no_reply`, `not_accepted`, `won`, `lost`.
- **"Replied" button:** on connected, message_1_sent, follow_up_sent, breakup_sent and no_reply
  (a late answer). It stops the sequence: status = replied, due today. Replies are answered by
  hand.
- **"Plan sent":** keeps status `replied`, sets `plan_sent_at`, makes the lead due in 3 days, and
  logs an activity row.
- **Activity:** every button click writes one row.

## Message type and templates
- **Message type = company_type:** label, management or agency. There are only these three.
- **12 template keys:** invite / msg1 / followup / breakup × label / management / agency, seeded
  in `supabase/seed.sql`. Only active versions are served.
- **One A/B test at a time.** Now: invites only, A = note, B = empty body (no note), both
  active. Everything else is version A only.
- **A/B assignment:** deterministic hash of (lead_id + template_key), stable and about 50/50.
- **No pricing in any message.** Every path aims at the free plan + 3 edits, then a call.

## Placeholders
`{First} {Company} {Artist} {Song} {City}`
- **Artist / Song:** the primary artist's name and `latest_release_title`.
- **City:** the first city in the primary artist's `top_cities`. Not used in any template yet.
- **Agency templates** use only `{First}` and `{Company}`.
- **Copy is disabled** while the text has an unfilled `{placeholder}` or a `[square-bracket note]`.
- **Invite notes** must be ≤ 200 characters; the count is shown.

## Queue score (one function: `queueScore` in lib/outreach.ts)
- replied leads always on top (+1000)
- labels and management, by `top_artist_listeners`: 1M–4M = 30, 100k–1M = 25, 10k–100k = 15
- agencies = 15
- overdue: +2 per day, max +10

## Rules
- Never automate anything on LinkedIn: invites, messages, likes, follows and withdrawals are
  always done by hand. Reading LinkedIn for research is allowed, never from the outreach account.
- Never guess an artist. Never research artists for agencies.
- Disqualify early, before enrichment, and keep disqualified leads with their reason.
- No pricing in any message.
- One A/B test at a time.
- Every button click is logged in activity with the template version.
- Templates live in the database and are edited in the dashboard.
- Keep it simple. Ask before adding anything not in this spec.
