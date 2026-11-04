-- Simplified CRM (see docs/SPEC.md): no reply templates, no voice note, no release logic,
-- disqualification, three message types, company cap in the queue.

-- 0. Drop what depends on the columns being removed (recreated below)
drop view public.queue;
drop view public.template_stats;
drop view public.lead_counts;
drop function public.record_step(uuid, text, text, date, text, text, text, text);

-- 1. Move leads off removed statuses
update public.leads set status = case status
    when 'follow_up_1_sent' then 'message_1_sent'   -- next: follow-up nudge
    when 'follow_up_2_sent' then 'follow_up_sent'   -- next: breakup
    else 'replied' end                               -- reply_sent, samples_sent, samples_nudged
where status in ('reply_sent', 'samples_sent', 'samples_nudged', 'follow_up_1_sent', 'follow_up_2_sent');

-- 2. leads
alter table public.leads drop column reply_type;
alter table public.leads
  add column company_staff int,
  add column top_artist_listeners int,
  add column disqualify_reason text,
  add column plan_url text,
  add column plan_sent_at timestamptz;
alter table public.leads drop constraint leads_research_status_check;
alter table public.leads add constraint leads_research_status_check
  check (research_status in ('new', 'artists_found', 'enriched', 'ready', 'disqualified'));
alter table public.leads add constraint leads_disqualify_reason_check
  check (disqualify_reason in ('major', 'roster_too_big', 'roster_too_small', 'company_too_big', 'distributor', 'competitor'));
alter table public.leads add constraint leads_disqualified_has_reason
  check ((research_status = 'disqualified') = (disqualify_reason is not null));

-- 3. artists
alter table public.artists
  drop column next_release_title, drop column next_release_date,
  drop column tiktok_sound_url, drop column tiktok_sound_videos,
  drop column hook_line, drop column samples_url,
  add column genre text,
  add column top_cities text;

-- 4. templates: three message types, no reply templates (rows replaced in the next migration)
delete from public.message_templates;
alter table public.message_templates drop column reply_type;
alter table public.message_templates drop constraint message_templates_audience_check;
alter table public.message_templates alter column audience set not null;
alter table public.message_templates add constraint message_templates_audience_check
  check (audience in ('label', 'management', 'agency'));

-- 5. activity
alter table public.activity drop column reply_type;

-- 6. Ready gate: agencies need no artist; label/management need the primary artist
create or replace function public.leads_check_ready() returns trigger language plpgsql as $$
begin
  if new.research_status = 'ready' and (tg_op = 'INSERT' or old.research_status is distinct from 'ready') then
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

-- 7. One click = one lead update + one activity row. "Plan sent": same status, p_plan_sent = true.
create function public.record_step(
  p_lead_id uuid, p_from_status text, p_to_status text, p_next_action_at date,
  p_template_key text default null, p_version text default null, p_text_sent text default null,
  p_plan_sent boolean default false
) returns void language plpgsql security invoker set search_path = public as $$
begin
  update public.leads
  set status            = p_to_status,
      status_changed_at = case when status is distinct from p_to_status then now() else status_changed_at end,
      next_action_at    = p_next_action_at,
      plan_sent_at      = case when p_plan_sent then now() else plan_sent_at end
  where id = p_lead_id and status = p_from_status;
  if not found then
    raise exception 'Lead % is not in status % any more. Reload.', p_lead_id, p_from_status;
  end if;
  insert into public.activity (lead_id, from_status, to_status, template_key, version, text_sent)
  values (p_lead_id, p_from_status, p_to_status, p_template_key, p_version, p_text_sent);
end $$;
revoke all on function public.record_step(uuid, text, text, date, text, text, text, boolean) from public, anon;
grant execute on function public.record_step(uuid, text, text, date, text, text, text, boolean) to authenticated;

-- 8. Queue: ready, due, not final, max 2 active contacts per company
create view public.queue with (security_invoker = true) as
with active as (
  select l.*,
         row_number() over (
           partition by lower(trim(l.company_name))
           order by (l.status <> 'to_do') desc,                  -- in-progress contacts keep their slot
                    case when l.title ~* '(founder|owner|ceo|president|managing director)' then 1
                         when l.title ~* '(label manager|general manager|\mgm\M)' then 2
                         when l.title ~* 'head of marketing' then 3
                         else 4 end,
                    l.created_at) as company_slot
  from public.leads l
  where l.research_status = 'ready'
    and l.status not in ('no_reply', 'not_accepted', 'lost')   -- these free a slot; won keeps it
)
select a.*, ar.id as artist_id, ar.name as artist_name, ar.spotify_url, ar.monthly_listeners,
       ar.latest_release_title, ar.genre, ar.top_cities,
       ar.instagram_url, ar.instagram_followers, ar.tiktok_url, ar.tiktok_followers
from active a
left join public.artists ar on ar.lead_id = a.id and ar.is_primary   -- agencies have no artist
where a.company_slot <= 2
  and a.status <> 'won'
  and a.linkedin_url is not null
  and a.next_action_at is not null and a.next_action_at <= public.app_today();

-- 9. A/B stats: per key + version; message_type and step included for grouping
create view public.template_stats with (security_invoker = true) as
with sends as (
  select template_key, version, lead_id, count(*) as times, min(created_at) as first_sent_at
  from public.activity where template_key is not null group by 1, 2, 3
), outcomes as (
  select s.*,
    exists (select 1 from public.activity x where x.lead_id = s.lead_id and x.created_at > s.first_sent_at
            and x.to_status = 'connected') as connected,
    exists (select 1 from public.activity x where x.lead_id = s.lead_id and x.created_at > s.first_sent_at
            and x.to_status = 'replied' and x.from_status <> 'replied') as replied,
    exists (select 1 from public.activity x where x.lead_id = s.lead_id and x.created_at > s.first_sent_at
            and x.to_status = 'call_booked') as call_booked
  from sends s
)
select t.key, t.version, t.audience as message_type, t.status as step, t.title, t.active,
       coalesce(sum(o.times), 0)::int as times_sent,
       count(o.template_key)::int as leads_sent,
       count(*) filter (where o.connected)::int as connected,
       count(*) filter (where o.replied)::int as replied,
       count(*) filter (where o.call_booked)::int as call_booked
from public.message_templates t
left join outcomes o on o.template_key = t.key and o.version = t.version
group by t.key, t.version, t.audience, t.status, t.title, t.active;

-- 10. Dashboard counts, with disqualify reason
create view public.lead_counts with (security_invoker = true) as
select research_status, status, disqualify_reason, count(*)::int as n
from public.leads group by 1, 2, 3;
