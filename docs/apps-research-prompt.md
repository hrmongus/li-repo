# Apps research prompt

Paste into Claude with the browser (claude --chrome). The CSV it returns is uploaded on the Upload
page with the header switch on **Apps**. The column list must match `APP_CSV_COLUMNS` in
`lib/leads.ts` (an extra `notes` column is kept in the lead's notes). Fill in the [EDIT] lines first.

```text
You are researching app founders for LinkedIn outreach. We sell faceless TikTok page campaigns
(fan/niche pages posting short edits about a product, nobody on camera). Your job: find apps that
fit, find their founders, and deliver ONE CSV file in the exact format below. Use the browser.

## Targets  [EDIT before running]
- Platform: iOS App Store (Google Play only if the app isn't on iOS).
- Category: consumer apps that can show well in short videos (e.g. games, health & fitness,
  productivity, education, photo/video, lifestyle, social, finance for consumers).
- Size: rating_count between [500] and [100,000] on the App Store (indie/startup, not big brands).
- Team: small, founder-led (roughly under 50 staff). Skip apps owned by big companies.
- Released or updated in the last [24] months.
- Sources to mine: App Store category charts, "New Apps We Love", Product Hunt, YC company directory
  (consumer), Crunchbase, indie hacker lists. Record where you found each app in `source`.
- Goal for this run: [50] apps.

## Per app
1. Open the App Store page. Record app_name (as shown), app_name_short (the brand name people use,
   e.g. "BePresent" for "BePresent: Screen Time Control"; used in messages), app_store_url (canonical
   https://apps.apple.com/<country>/app/<slug>/id<digits>, no query string), rating_count (plain
   integer), avg_rating (e.g. 4.7), genre (App Store primary category), release_date (first release,
   YYYY-MM-DD, leave empty if unknown).
2. Find the company website (from the App Store "Developer Website" link first).
3. Find the founders (max 2 per app: CEO/co-founders first). Sources: the website's About/Team page,
   Crunchbase, YC profile, press, Product Hunt maker profiles, X bios. Never guess a founder.
4. For each founder find, if public:
   - LinkedIn profile URL (https://www.linkedin.com/in/<slug>): find it with a web search first
     ("<name> <app/company> linkedin"). Open LinkedIn only to confirm when a search can't. Max 100
     LinkedIn pages per day. If LinkedIn shows any warning, login wall, or verification: stop ALL
     LinkedIn work for the rest of the run and continue with other sources.
   - X profile URL (https://x.com/<handle>).
   - Founder's own Instagram (https://www.instagram.com/<handle>) → instagram_url.
   - Work email from public pages only (website, press kit, X/LinkedIn bio, Product Hunt, Crunchbase
     free view, app support page). Personal work email first; otherwise the company's general
     address (support@, hello@) marked as generic. NEVER guess an email from a pattern, NEVER use
     paid or login-only email finders (Hunter, Apollo, RocketReach, etc.).
5. Company-level extras: company_instagram_url (the app's / company's own Instagram account,
   https://www.instagram.com/<handle>; same on both founder rows), crunchbase_url, yc_batch (e.g. W24, S23; empty if not YC),
   tiktok_handle_found (the app's own TikTok account handle like @appname, empty if none found).
6. Keep a founder only if you have their name AND at least one contact: LinkedIn, email, X, their
   own Instagram, or the company Instagram. We do outreach on LinkedIn and on Instagram, so a
   founder with only an Instagram (own or company) is still worth a row. No contact at all: skip.
7. Never automate anything on LinkedIn: no connection requests, messages, likes or follows. Only
   read.

## Output: one CSV file, UTF-8, comma-separated, header row exactly:
founder_name,founder_title,linkedin_url,x_url,instagram_url,company_instagram_url,email,email_source,email_type,email_alt,app_name,app_name_short,app_store_url,rating_count,avg_rating,genre,release_date,website,crunchbase_url,tiktok_handle_found,yc_batch,source,notes

Rules for the file:
- One row per founder. Max 2 rows per app. Repeat the app columns (app_name … source) on both
  founder rows of the same app, identical.
- Empty cell = unknown. Never write "N/A", "none", "-" or "unknown".
- founder_name: full name ("Jane Doe"). founder_title: as listed ("Co-founder & CEO").
- linkedin_url: profile URL only (/in/...), no company pages, no query strings.
- x_url: full URL https://x.com/<handle>.
- instagram_url: the founder's own Instagram. company_instagram_url: the app's/company's Instagram.
  Full URLs https://www.instagram.com/<handle>, no ?igsh= or other query strings.
- email: one address. email_source: the URL where you saw it. email_type: personal or generic.
  email_alt: a second public address if there is one (else empty).
- rating_count: digits only, no commas, no "k" (12345, not 12.3k).
- avg_rating: decimal with a dot, 0–5 (4.7).
- release_date: YYYY-MM-DD.
- website: full URL of the company/app site.
- source: where you found the app (e.g. "App Store Health & Fitness chart", "YC directory", "Product Hunt").
- notes: short proof and remarks (e.g. "founder from team page https://…; email generic").
- Quote any cell containing a comma, quote or line break with double quotes ("" inside quotes).
- No duplicate founders (same LinkedIn, X or email) and no duplicate apps (same app_store_url).

## Process
- Work through the whole batch without pausing; stop only for blockers (LinkedIn warning: drop
  LinkedIn and continue; anything else: report it).
- Write the CSV progressively so nothing is lost if the run stops. At the end, give the file and a
  short summary: apps checked, apps kept, founders found, how many with LinkedIn / email / X /
  Instagram (own or company), and
  any skipped apps with the reason (too big, no founder found, no contact).
```
