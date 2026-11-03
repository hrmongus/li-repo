# CLAUDE.md

Internal CRM for LinkedIn outreach to music labels and artist managers (Propagandistan, faceless
TikTok fan-page campaigns).

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
lib/outreach.ts              business logic: FLOW (statuses/buttons/due dates), audience,
                             template choice, A/B version, rendering + Copy checks, queueScore
lib/outreach.test.ts         tests for queueScore and A/B assignment
lib/leads.ts                 upload: CSV parsing, column matching, LinkedIn URL normalization
lib/supabase/server.ts       Supabase client for server components and server actions
middleware.ts                session refresh; signed-out visitors go to /login
app/login                    email + password sign-in
app/queue                    Queue: Due (sorted by queueScore) and All leads (search + filters)
app/dashboard                status counts, A/B stats, template editor
app/upload                   CSV upload and pasted LinkedIn URLs
supabase/migrations/         schema (tables, views, RLS, record_step function)
supabase/seed.sql            message templates (idempotent; never overwrites dashboard edits)
supabase/config.toml         Supabase CLI config
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
  and writes the activity row in one transaction. Never update `leads.status` any other way.
- **Changing the sequence:** edit `FLOW` in `lib/outreach.ts` and the template rows
  (`message_templates.status` = the status a message is sent FROM).
  - Statuses are plain text in the database, so no migration is needed.
  - Exception: the `template_stats` view hard-codes `connected`, `call_booked`, `yes_send` and
    `picks_one`. Renaming any of those needs a migration.
- **Time zone:** "today" is Europe/Bratislava, both in SQL (`app_today()`) and TypeScript
  (`todayStr()`).
- **Queue order:** done only by `queueScore()`. The `queue` view is unsorted.

## Rules
- Never auto-send anything on LinkedIn: invites, messages, likes, follows and withdrawals are
  always done by hand. Reading or scraping LinkedIn profile data for research is allowed.
- Never guess an artist. Only artists confirmed from the company's own website, socials or
  release credits get added.
- A lead reaches the queue only when research_status = ready. That requires a LinkedIn URL,
  first name, company, and a primary artist with a name, a song and monthly listeners. The
  database enforces this.
- Every button click is logged in activity with the template version, so the A/B stats stay
  clean.
- Templates live in the database and are edited in the dashboard.
- Keep it simple. Ask before adding anything not in docs/SPEC.md.
