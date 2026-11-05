-- LinkedIn check as the first outreach step (done by a VA in the CRM): Active / Inactive.
-- Research no longer checks LinkedIn activity.

-- 1. New leads start at li_check; leads not yet worked or checked move there too.
alter table public.leads alter column status set default 'li_check';
update public.leads set status = 'li_check'
where status = 'to_do' and li_checked_at is null;

-- 2. record_step gets p_li_active: true = active (last activity = today), false = inactive.
drop function public.record_step(uuid, text, text, date, text, text, text, boolean);
create function public.record_step(
  p_lead_id uuid, p_from_status text, p_to_status text, p_next_action_at date,
  p_template_key text default null, p_version text default null, p_text_sent text default null,
  p_plan_sent boolean default false, p_li_active boolean default null
) returns void language plpgsql security invoker set search_path = public as $$
begin
  update public.leads
  set status            = p_to_status,
      status_changed_at = case when status is distinct from p_to_status then now() else status_changed_at end,
      next_action_at    = p_next_action_at,
      plan_sent_at      = case when p_plan_sent then now() else plan_sent_at end,
      li_checked_at     = case when p_li_active is null then li_checked_at else public.app_today() end,
      last_li_activity  = case when p_li_active is null then last_li_activity
                               when p_li_active then public.app_today() else null end
  where id = p_lead_id and status = p_from_status;
  if not found then
    raise exception 'Lead % is not in status % any more. Reload.', p_lead_id, p_from_status;
  end if;
  insert into public.activity (lead_id, from_status, to_status, template_key, version, text_sent)
  values (p_lead_id, p_from_status, p_to_status, p_template_key, p_version, p_text_sent);
end $$;
revoke all on function public.record_step(uuid, text, text, date, text, text, text, boolean, boolean) from public, anon;
grant execute on function public.record_step(uuid, text, text, date, text, text, text, boolean, boolean) to authenticated;

-- 3. Queue: LinkedIn-check leads are all shown (outside the company cap), so the VA checks every
--    contact; the 4 slots per company are then filled with the most active checked people.
drop view public.queue;
create view public.queue with (security_invoker = true) as
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
         end as company_slot
  from public.leads l
  where l.research_status = 'ready'
    and l.status not in ('no_reply', 'not_accepted', 'lost')
)
select a.*, ar.id as artist_id, ar.name as artist_name, ar.spotify_url, ar.monthly_listeners,
       ar.latest_release_title, ar.genre, ar.top_cities,
       ar.instagram_url, ar.instagram_followers, ar.tiktok_url, ar.tiktok_followers
from active a
left join public.artists ar on ar.lead_id = a.id and ar.is_primary
where a.company_slot <= 4
  and a.status <> 'won'
  and a.linkedin_url is not null
  and a.next_action_at is not null and a.next_action_at <= public.app_today();
