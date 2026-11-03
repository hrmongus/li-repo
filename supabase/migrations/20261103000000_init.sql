-- Initial schema: leads, artists, message_templates, activity + queue and template_stats views.
-- See docs/SPEC.md. Outreach statuses and reply types are plain text on purpose: the
-- sequence lives in lib/outreach.ts (FLOW) and changes without a migration.

-- "Today" for the team, used for due dates.
create function public.app_today() returns date
language sql stable
as $$ select (now() at time zone 'Europe/Bratislava')::date $$;

-- Canonical LinkedIn URL so dedupe works: https://www.linkedin.com/in/slug
create function public.normalize_linkedin_url(url text) returns text
language sql immutable
as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(lower(trim(url)), '[?#].*$', ''),
             '^(https?://)?([a-z]{2,3}\.)?(www\.)?linkedin\.com', 'https://www.linkedin.com'),
           '/+$', '')
$$;

-- ---------- leads ----------

create table public.leads (
  id                uuid primary key default gen_random_uuid(),
  full_name         text,
  first_name        text,
  title             text,
  company_name      text,
  company_type      text check (company_type in ('label', 'management', 'other')),
  company_website   text,
  company_socials   text,
  linkedin_url      text not null unique,
  email             text,
  country           text,
  research_status   text not null default 'new'
                    check (research_status in ('new', 'artists_found', 'enriched', 'ready')),
  status            text not null default 'to_do',
  status_changed_at timestamptz not null default now(),
  next_action_at    date default public.app_today(),
  reply_type        text,
  notes             text,
  created_at        timestamptz not null default now()
);

create index leads_status_idx on public.leads (status);
create index leads_next_action_at_idx on public.leads (next_action_at);

create function public.leads_normalize_url() returns trigger
language plpgsql
as $$
begin
  new.linkedin_url := public.normalize_linkedin_url(new.linkedin_url);
  return new;
end $$;

create trigger leads_normalize_url
before insert or update of linkedin_url on public.leads
for each row execute function public.leads_normalize_url();

-- ---------- artists ----------

create table public.artists (
  id                   uuid primary key default gen_random_uuid(),
  lead_id              uuid not null references public.leads (id) on delete cascade,
  is_primary           boolean not null default false,
  name                 text not null,
  spotify_url          text,
  monthly_listeners    integer,
  instagram_url        text,
  instagram_followers  integer,
  tiktok_url           text,
  tiktok_followers     integer,
  latest_release_title text,
  next_release_title   text,
  next_release_date    date,
  tiktok_sound_url     text,
  tiktok_sound_videos  integer,  -- videos using the song's official sound
  hook_line            text,     -- lyric/section to mention in the voice note
  samples_url          text,     -- link to the sample edits made for this artist
  notes                text,
  checked_at           timestamptz
);

create index artists_lead_id_idx on public.artists (lead_id);

-- At most one primary artist per lead.
create unique index artists_one_primary_per_lead on public.artists (lead_id) where is_primary;

-- At most 3 artists per lead.
create function public.artists_max_three() returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.artists where lead_id = new.lead_id and id <> new.id) >= 3 then
    raise exception 'A lead can have at most 3 artists';
  end if;
  return new;
end $$;

create trigger artists_max_three
before insert or update of lead_id on public.artists
for each row execute function public.artists_max_three();

-- Ready gate: a lead can only be marked ready with a LinkedIn URL, first name, company and
-- a primary artist with name, a song and monthly listeners.
create function public.leads_check_ready() returns trigger
language plpgsql
as $$
begin
  if new.research_status = 'ready' and (tg_op = 'INSERT' or old.research_status is distinct from 'ready') then
    if coalesce(new.first_name, '') = '' or coalesce(new.company_name, '') = '' then
      raise exception 'Lead % cannot be ready: first_name and company_name are required', new.linkedin_url;
    end if;
    if not exists (
      select 1 from public.artists a
      where a.lead_id = new.id
        and a.is_primary
        and coalesce(a.name, '') <> ''
        and coalesce(a.next_release_title, a.latest_release_title, '') <> ''
        and a.monthly_listeners is not null
    ) then
      raise exception 'Lead % cannot be ready: needs a primary artist with name, a song and monthly listeners', new.linkedin_url;
    end if;
  end if;
  return new;
end $$;

create trigger leads_check_ready
before insert or update of research_status on public.leads
for each row execute function public.leads_check_ready();

-- ---------- message_templates ----------

create table public.message_templates (
  id         uuid primary key default gen_random_uuid(),
  key        text not null,
  version    text not null check (version in ('A', 'B')),
  status     text not null,  -- the outreach status this message is sent FROM
  audience   text check (audience in ('label', 'manager', 'release')),  -- null = any
  reply_type text,           -- for reply templates
  title      text not null,
  body       text not null default '',  -- empty invite body = connection request without a note
  active     boolean not null default true,
  unique (key, version)
);

-- ---------- activity ----------

create table public.activity (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.leads (id) on delete cascade,
  from_status   text,
  to_status     text,
  template_key  text,
  version       text,
  text_sent     text,
  reply_type    text,  -- only set on "Replied" clicks: the reply type received
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index activity_lead_id_idx on public.activity (lead_id, created_at);
create index activity_template_idx on public.activity (template_key, version);

-- One button click = one lead update + one activity row, in one transaction.
-- Fails if the lead is no longer in p_from_status (double click, or someone else moved it).
create function public.record_step(
  p_lead_id        uuid,
  p_from_status    text,
  p_to_status      text,
  p_next_action_at date,
  p_template_key   text default null,
  p_version        text default null,
  p_text_sent      text default null,
  p_reply_type     text default null
) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.leads
  set status            = p_to_status,
      status_changed_at = case when status is distinct from p_to_status then now() else status_changed_at end,
      next_action_at    = p_next_action_at,
      reply_type        = coalesce(p_reply_type, reply_type)
  where id = p_lead_id and status = p_from_status;

  if not found then
    raise exception 'Lead % is not in status % any more. Reload.', p_lead_id, p_from_status;
  end if;

  insert into public.activity (lead_id, from_status, to_status, template_key, version, text_sent, reply_type)
  values (p_lead_id, p_from_status, p_to_status, p_template_key, p_version, p_text_sent, p_reply_type);
end $$;

-- ---------- views ----------

-- Ready leads due today or earlier, with the primary artist. Final and waiting statuses have
-- next_action_at = null, so they drop out without listing status names here.
-- Sorting is done by queueScore() in lib/outreach.ts.
create view public.queue with (security_invoker = true) as
select
  l.*,
  a.id                   as artist_id,
  a.name                 as artist_name,
  a.spotify_url,
  a.monthly_listeners,
  a.instagram_url,
  a.instagram_followers,
  a.tiktok_url,
  a.tiktok_followers,
  a.latest_release_title,
  a.next_release_title,
  a.next_release_date,
  a.tiktok_sound_url,
  a.tiktok_sound_videos,
  a.hook_line,
  a.samples_url,
  a.notes                as artist_notes,
  a.checked_at
from public.leads l
join public.artists a on a.lead_id = l.id and a.is_primary
where l.research_status = 'ready'
  and l.next_action_at is not null
  and l.next_action_at <= public.app_today();

-- Per template key + version: times sent, and how many of those leads LATER (after the first
-- send) got connected, replied, replied positively, booked a call.
-- Status/reply names hard-coded here: connected, call_booked, yes_send, picks_one.
-- Replied = an activity row with reply_type set (only "Replied" clicks set it).
create view public.template_stats with (security_invoker = true) as
with sends as (
  select template_key, version, lead_id, count(*) as times, min(created_at) as first_sent_at
  from public.activity
  where template_key is not null
  group by template_key, version, lead_id
),
outcomes as (
  select
    s.template_key,
    s.version,
    s.times,
    exists (select 1 from public.activity x where x.lead_id = s.lead_id and x.created_at > s.first_sent_at
            and x.to_status = 'connected') as connected,
    exists (select 1 from public.activity x where x.lead_id = s.lead_id and x.created_at > s.first_sent_at
            and x.reply_type is not null) as replied,
    exists (select 1 from public.activity x where x.lead_id = s.lead_id and x.created_at > s.first_sent_at
            and x.reply_type in ('yes_send', 'picks_one')) as replied_positive,
    exists (select 1 from public.activity x where x.lead_id = s.lead_id and x.created_at > s.first_sent_at
            and x.to_status = 'call_booked') as call_booked
  from sends s
)
select
  t.key,
  t.version,
  t.title,
  t.active,
  coalesce(sum(o.times), 0)::int                          as times_sent,
  count(o.template_key)::int                              as leads_sent,
  count(*) filter (where o.connected)::int                as connected,
  count(*) filter (where o.replied)::int                  as replied,
  count(*) filter (where o.replied_positive)::int         as replied_positive,
  count(*) filter (where o.call_booked)::int              as call_booked
from public.message_templates t
left join outcomes o on o.template_key = t.key and o.version = t.version
group by t.key, t.version, t.title, t.active;

-- ---------- RLS: signed-in team members can read and write everything ----------

alter table public.leads             enable row level security;
alter table public.artists           enable row level security;
alter table public.message_templates enable row level security;
alter table public.activity          enable row level security;

create policy "team full access" on public.leads             for all to authenticated using (true) with check (true);
create policy "team full access" on public.artists           for all to authenticated using (true) with check (true);
create policy "team full access" on public.message_templates for all to authenticated using (true) with check (true);
create policy "team full access" on public.activity          for all to authenticated using (true) with check (true);

revoke all on function public.record_step(uuid, text, text, date, text, text, text, text) from public, anon;
grant execute on function public.record_step(uuid, text, text, date, text, text, text, text) to authenticated;
