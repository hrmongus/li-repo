# CLAUDE.md

Internal CRM for LinkedIn outreach to music labels, artist managers and agencies (Propagandistan,
faceless TikTok fan-page campaigns).

**`docs/SPEC.md` is the source of truth.** Read it before any change. If code and spec disagree,
ask.

## Stack
- **App:** Next.js 15 (App Router, TypeScript, server actions) and Tailwind 4.
- **Data and auth:** Supabase (Postgres + Auth).
- **Deploy:** Vercel.
- **Tests:** Vitest.

## Folder layout
```
docs/SPEC.md                 spec (source of truth)
lib/outreach.ts              business logic: FLOW (statuses/buttons/due dates), message type,
                             template choice, A/B version, rendering + Copy checks, queueScore
lib/outreach.test.ts         tests for queueScore and A/B assignment
lib/leads.ts                 upload: CSV parsing, column matching, LinkedIn URL normalization
lib/supabase/server.ts       Supabase client for server components and server actions
middleware.ts                session refresh; signed-out visitors go to /login
app/login                    email + password sign-in
app/queue                    Queue: Due (sorted by queueScore) and All leads (search + filters)
app/dashboard                status + disqualified counts, sequence with template editor, A/B stats
app/upload                   CSV upload, pasted LinkedIn URLs, exports for researchers
app/export                   GET /export?type=skip|backlog: CSV downloads for external researchers
supabase/migrations/         schema (tables, views, RLS, record_step function)
supabase/seed.sql            message templates (idempotent; never overwrites dashboard edits)
supabase/config.toml         Supabase CLI config
.claude/skills/research-leads  /research-leads: lead research procedure (run locally with claude --chrome)
.mcp.json                    Supabase MCP server for the crm project (OAuth via /mcp)
```

## Commands
```bash
npm install
npm run dev          # http://localhost:3000 (needs .env.local)
npm run build
npm test             # vitest
npm run typecheck    # tsc
npm run db:link      # once: link to the Supabase project (asks for project ref + DB password)
npm run db:push      # apply new migrations + seed to the linked project
```
New migration: `npx supabase migration new <name>`, then edit the file in `supabase/migrations/`.

## How things fit together
- **Business logic** lives in `lib/`. Keep it as pure functions; UI and server actions call it.
- **Button clicks** use `clickButton()` / `clickReplied()` from `lib/outreach.ts` to compute the
  transition, then call the database function `record_step()`. That function updates the lead
  and writes the activity row in one transaction. "Plan sent" uses it too (`p_plan_sent`).
  Never update `leads.status` any other way.
- **Message type = company_type** (label, management, agency). Templates: `message_templates`
  rows with `status` = the step a message is sent from and `audience` = the message type.
- **Changing the sequence:** edit `FLOW` in `lib/outreach.ts` and the template rows. Statuses are
  plain text, but the `queue` view (final statuses) and `template_stats` view (`connected`,
  `replied`, `call_booked`) hard-code a few names; renaming those needs a migration.
- **LinkedIn check (`li_check`)** is the first outreach step: a VA clicks Active / Inactive in the
  CRM (`record_step(..., p_li_active)`). New leads start there by default.
- **Company cap** (max 4 active contacts per company, most LinkedIn-active first) is computed in
  the `queue` view; leads at `li_check` are outside the cap so the VA sees all of them.
- **Time zone:** "today" is Europe/Bratislava, both in SQL (`app_today()`) and TypeScript
  (`todayStr()`).
- **Queue order:** done only by `queueScore()`. The `queue` view is unsorted.

## Research (`/research-leads`, procedure in `.claude/skills/research-leads/SKILL.md`)
Cheapest checks first, so bad leads stop early:
1. Classify `company_type` (label, management, agency, distributor, other).
2. Distributor → disqualify. Major (check the parent company) → disqualify.
3. Agency: check its services. Sells TikTok fan pages / seeding / UGC / creator campaigns →
   disqualify as `competitor`. No artist research for agencies, ever.
4. Label / management: find the **current** roster (on the company's site/socials, or a release
   credited to it in the last 2 years), record the **biggest** artist (any size) and set
   `top_artist_listeners`; apply `roster_too_big` (over 4M) and `roster_too_small` (no artist
   with 10k+). Never re-pick a smaller artist to get around this.
5. If still qualified: up to 3 roster artists, primary = the biggest, with Spotify URL, monthly
   listeners, latest song (original single: no remix, cover, live version or album title), genre
   and top cities (Instagram/TikTok if easy).
6. Staff count last (only for leads that passed the checks above): public sources first, the
   LinkedIn company page only if nothing else works, never from the outreach account. Once per
   company, copied to all its contacts. `company_too_big` only when a reliable source clearly
   shows over 50 staff; estimates and unknowns pass (`company_staff` left empty). LinkedIn cap:
   100 pages a day.
6b. Research never checks LinkedIn activity (a VA does it at `li_check`), finds profile URLs with
   a web search first, and stops all LinkedIn work for the day at any warning or verification.
7. One consistent `company_name` per company; a parenthetical distributor or parent goes in notes.
7b. No website and no confirmable roster → `NO MATCH: no website or roster found`, move on.
   Companies with a website are researched first. Artist with only features → latest original
   single even if older (noted).
8. Ready = LinkedIn URL + first name + company; label/management also need a primary artist with
   name, song and monthly listeners. The database enforces this.
9. Once per company: an existing company result (disqualified for a company reason, or ready) is
   copied to the other contacts; otherwise the checks run once and go to every open contact.
   Unresolved leads researched in the last 24 hours aren't re-picked. A run does the whole batch
   and stops only for blockers.

## Rules
- Never automate anything on LinkedIn. Invites, messages, likes, follows and withdrawals are
  always done by hand.
- Never guess an artist. Never research artists for agencies.
- Disqualify early, before enrichment, and keep disqualified leads with their reason.
- No pricing in any message.
- One A/B test at a time.
- Every button click is logged in activity with the template version, so the A/B stats stay
  clean.
- Templates live in the database and are edited in the dashboard.
- Keep it simple. Ask before adding anything not in docs/SPEC.md.
