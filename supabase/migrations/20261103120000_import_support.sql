-- Spreadsheet import support (see docs/SPEC.md):
-- 1. Leads may come in without a LinkedIn URL; research finds it. Still unique when present.
-- 2. New company types agency and distributor. They stay out of the queue until they have templates.
-- 3. The ready gate now checks the LinkedIn URL explicitly (the column is no longer NOT NULL).

alter table public.leads alter column linkedin_url drop not null;

alter table public.leads drop constraint leads_company_type_check;
alter table public.leads add constraint leads_company_type_check
  check (company_type in ('label', 'management', 'agency', 'distributor', 'other'));

create or replace function public.leads_check_ready() returns trigger
language plpgsql
as $$
begin
  if new.research_status = 'ready' and (tg_op = 'INSERT' or old.research_status is distinct from 'ready') then
    if coalesce(new.linkedin_url, '') = '' then
      raise exception 'Lead % cannot be ready: LinkedIn URL is required', coalesce(new.full_name, new.id::text);
    end if;
    if coalesce(new.first_name, '') = '' or coalesce(new.company_name, '') = '' then
      raise exception 'Lead % cannot be ready: first_name and company_name are required', coalesce(new.full_name, new.id::text);
    end if;
    if not exists (
      select 1 from public.artists a
      where a.lead_id = new.id
        and a.is_primary
        and coalesce(a.name, '') <> ''
        and coalesce(a.next_release_title, a.latest_release_title, '') <> ''
        and a.monthly_listeners is not null
    ) then
      raise exception 'Lead % cannot be ready: needs a primary artist with name, a song and monthly listeners', coalesce(new.full_name, new.id::text);
    end if;
  end if;
  return new;
end $$;

-- Queue: same as before, plus it requires a LinkedIn URL and leaves out agencies and distributors.
create or replace view public.queue with (security_invoker = true) as
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
  and l.linkedin_url is not null
  and coalesce(l.company_type, 'other') not in ('agency', 'distributor')
  and l.next_action_at is not null
  and l.next_action_at <= public.app_today();

-- Helps the import and research find leads without a LinkedIn URL.
create index leads_email_idx on public.leads (lower(email));
