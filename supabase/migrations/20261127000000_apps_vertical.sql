-- Second lead vertical: apps (founders of consumer apps). Music stays exactly as it is.
-- Every existing lead becomes vertical = 'music'. Apps leads have company_type = 'app', their app
-- in the apps table (parallel to artists), and templates with audience = 'app'.
-- The instantly_email_export views are music-only and are not touched here.

-- 1. leads: vertical + founder contact columns.
alter table public.leads
  add column vertical text not null default 'music' check (vertical in ('music', 'apps')),
  add column x_url text,
  add column instagram_url text,
  add column crunchbase_url text,
  add column email_source text,   -- where the email was found
  add column email_type text,     -- e.g. personal / generic
  add column email_alt text;      -- a second address
create index leads_vertical_idx on public.leads (vertical);

alter table public.leads drop constraint leads_company_type_check;
alter table public.leads add constraint leads_company_type_check
  check (company_type in ('label', 'management', 'agency', 'distributor', 'other', 'app'));
-- company_type 'app' <=> vertical 'apps'.
alter table public.leads add constraint leads_vertical_company_type
  check ((vertical = 'apps') = (coalesce(company_type, '') = 'app'));

-- 2. apps: the founder's app (parallel to artists). One primary per lead.
create table public.apps (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.leads (id) on delete cascade,
  is_primary    boolean not null default false,
  app_name      text not null,
  app_store_url text,
  rating_count  int,
  avg_rating    numeric(3, 2),
  genre         text,
  release_date  date,
  tiktok_handle text,
  yc_batch      text,
  source        text,
  notes         text,
  created_at    timestamptz not null default now()
);
create index apps_lead_id_idx on public.apps (lead_id);
create index apps_app_store_url_idx on public.apps (app_store_url);
create unique index apps_one_primary_per_lead on public.apps (lead_id) where is_primary;
alter table public.apps enable row level security;
create policy "team full access" on public.apps for all to authenticated using (true) with check (true);

-- 3. Templates: audience 'app'.
alter table public.message_templates drop constraint message_templates_audience_check;
alter table public.message_templates add constraint message_templates_audience_check
  check (audience in ('label', 'management', 'agency', 'app'));

-- 4. Ready gate. Apps: founder name + at least one contact (LinkedIn, email or X).
--    Music rules unchanged.
create or replace function public.leads_check_ready() returns trigger language plpgsql as $$
begin
  if new.research_status = 'ready' and (tg_op = 'INSERT' or old.research_status is distinct from 'ready') then
    if new.company_type = 'app' then
      if coalesce(new.first_name, '') = '' then
        raise exception 'Lead % cannot be ready: needs the founder''s name', coalesce(new.full_name, new.id::text);
      end if;
      if coalesce(new.linkedin_url, '') = '' and coalesce(new.email, '') = '' and coalesce(new.x_url, '') = '' then
        raise exception 'Lead % cannot be ready: needs a LinkedIn URL, email or X', coalesce(new.full_name, new.id::text);
      end if;
      return new;
    end if;
    if coalesce(new.linkedin_url, '') = '' or coalesce(new.first_name, '') = '' or coalesce(new.company_name, '') = '' then
      raise exception 'Lead % cannot be ready: needs LinkedIn URL, first name and company', coalesce(new.full_name, new.id::text);
    end if;
    if new.company_type = 'agency' then return new; end if;
    if new.company_type is distinct from 'label' and new.company_type is distinct from 'management' then
      raise exception 'Lead % cannot be ready: only label, management or agency leads can be ready', coalesce(new.full_name, new.id::text);
    end if;
    if not exists (select 1 from public.artists a where a.lead_id = new.id and a.is_primary
                   and coalesce(a.name, '') <> '' and coalesce(a.latest_release_title, '') <> ''
                   and a.monthly_listeners is not null) then
      raise exception 'Lead % cannot be ready: needs a primary artist with name, song and monthly listeners', coalesce(new.full_name, new.id::text);
    end if;
  end if;
  return new;
end $$;

-- 5. queue: same rules; the old columns keep their order, the new ones are appended at the end.
--    leads.instagram_url and apps.genre are aliased because artists already has those names.
create or replace view public.queue with (security_invoker = true) as
with active as (
  select l.*,
         case when l.status = 'li_check' then 0 else
           row_number() over (
             partition by lower(trim(l.company_name)), (l.status = 'li_check')
             order by (l.status <> 'to_do') desc,
                      case when l.li_checked_at is null then 2
                           when l.last_li_activity is null then 3
                           when l.last_li_activity >= public.app_today() - 90 then 0
                           else 1 end,
                      l.last_li_activity desc nulls last,
                      case when l.title ~* '(founder|owner|ceo|president|managing director)' then 1
                           when l.title ~* '(label manager|general manager|\mgm\M)' then 2
                           when l.title ~* 'head of marketing' then 3
                           else 4 end,
                      l.created_at)
         end as company_slot,
         (select max(s.sender) from public.leads s
          where s.sender is not null and lower(trim(s.company_name)) = lower(trim(l.company_name))) as company_sender
  from public.leads l
  where l.research_status = 'ready'
    and l.status not in ('no_reply', 'not_accepted', 'lost')
)
select a.id, a.full_name, a.first_name, a.title, a.company_name, a.company_type, a.company_website,
       a.company_socials, a.linkedin_url, a.email, a.country, a.research_status, a.status,
       a.status_changed_at, a.next_action_at, a.notes, a.created_at, a.company_staff,
       a.top_artist_listeners, a.disqualify_reason, a.plan_url, a.plan_sent_at, a.last_li_activity,
       a.li_checked_at, a.sender, a.company_slot, a.company_sender,
       ar.id as artist_id, ar.name as artist_name, ar.spotify_url, ar.monthly_listeners,
       ar.latest_release_title, ar.genre, ar.top_cities,
       ar.instagram_url, ar.instagram_followers, ar.tiktok_url, ar.tiktok_followers,
       -- appended: apps vertical
       a.vertical, a.x_url, a.instagram_url as lead_instagram_url, a.crunchbase_url, a.email_type,
       ap.app_name, ap.app_store_url, ap.rating_count, ap.genre as app_genre, ap.tiktok_handle
from active a
left join public.artists ar on ar.lead_id = a.id and ar.is_primary
left join public.apps ap on ap.lead_id = a.id and ap.is_primary
where a.company_slot <= 4
  and a.status <> 'won'
  and a.linkedin_url is not null
  and a.next_action_at is not null and a.next_action_at <= public.app_today();

-- 6. lead_counts: per vertical too (appended).
create or replace view public.lead_counts with (security_invoker = true) as
select research_status, status, disqualify_reason, count(*)::int as n, vertical
from public.leads group by research_status, status, disqualify_reason, vertical;

-- 7. Apps templates: 4 steps. Same content as supabase/seed.sql. Placeholders: {firstName} {company} {app_name}.
insert into public.message_templates (key, version, status, audience, title, body) values
('invite_app', 'A', 'warmed_up', 'app', 'Invite: app',
$$Hi {firstName}, I run faceless TikTok page campaigns for consumer apps and {app_name} caught my eye. Would be good to connect.$$),
('msg1_app', 'A', 'connected', 'app', 'Message 1: app',
$$Thanks for connecting, {firstName}.

A lot of app installs on TikTok now come from faceless pages posting short edits every day, with nobody on camera.

I sketched a page plan for {app_name}: the page angles, who each one targets, plus 3 sample edits. Want me to send it?$$),
('followup_app', 'A', 'message_1_sent', 'app', 'Follow-up: app',
$${firstName}, still happy to send the page plan and 3 sample edits for {app_name}. Just say yes and they're yours.$$),
('breakup_app', 'A', 'follow_up_sent', 'app', 'Breakup: app',
$$Last one from me, {firstName}. Is TikTok growth for {app_name} something you look after, or someone else at {company}?

Happy to get out of your inbox either way.$$)
on conflict (key, version) do nothing;
