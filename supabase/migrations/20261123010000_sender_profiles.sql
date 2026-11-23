-- Sender profiles: three LinkedIn accounts (Andrej, Narek, Mher) work the outreach.
-- A lead gets its profile when that profile does the warm-up (claim at warm-up) and keeps it for
-- good. One profile per company: once a profile owns any contact at a company, the company's
-- other contacts can only be claimed by that same profile. The LinkedIn check (VA) is not
-- profile work, so li_check clicks carry no sender.

-- 1. Columns.
alter table public.leads add column sender text
  check (sender in ('Andrej', 'Narek', 'Mher'));
alter table public.activity add column sender text
  check (sender in ('Andrej', 'Narek', 'Mher'));
create index leads_sender_company_idx on public.leads (lower(trim(company_name))) where sender is not null;

-- 2. Backfill: everything already warmed up or further was done from Andrej's account.
update public.leads set sender = 'Andrej' where status not in ('li_check', 'to_do');
update public.activity set sender = 'Andrej' where from_status <> 'li_check';

-- 3. record_step gets p_sender: the profile clicking. It must match the lead's owner; the warm-up
--    (from to_do) claims an unowned lead, unless the company already belongs to another profile.
drop function public.record_step(uuid, text, text, date, text, text, text, boolean, boolean);
create function public.record_step(
  p_lead_id uuid, p_from_status text, p_to_status text, p_next_action_at date,
  p_template_key text default null, p_version text default null, p_text_sent text default null,
  p_plan_sent boolean default false, p_li_active boolean default null, p_sender text default null
) returns void language plpgsql security invoker set search_path = public as $$
declare
  v_owner text;
  v_company text;
  v_company_owner text;
begin
  select sender, lower(trim(company_name)) into v_owner, v_company
  from public.leads where id = p_lead_id for update;

  if p_from_status <> 'li_check' then
    if p_sender is null then
      raise exception 'Pick a LinkedIn profile tab (Andrej, Narek or Mher) before clicking.';
    end if;
    if v_owner is not null and v_owner <> p_sender then
      raise exception 'This lead belongs to %. Work it from the % tab.', v_owner, v_owner;
    end if;
    if v_owner is null then
      if p_from_status <> 'to_do' then
        raise exception 'This lead has no profile yet; it is claimed at the warm-up.';
      end if;
      select max(sender) into v_company_owner
      from public.leads
      where lower(trim(company_name)) = v_company and sender is not null and id <> p_lead_id;
      if v_company_owner is not null and v_company_owner <> p_sender then
        raise exception 'This company is worked by %. Leave it to the % tab.', v_company_owner, v_company_owner;
      end if;
    end if;
  end if;

  update public.leads
  set status            = p_to_status,
      status_changed_at = case when status is distinct from p_to_status then now() else status_changed_at end,
      next_action_at    = p_next_action_at,
      plan_sent_at      = case when p_plan_sent then now() else plan_sent_at end,
      li_checked_at     = case when p_li_active is null then li_checked_at else public.app_today() end,
      last_li_activity  = case when p_li_active is null then last_li_activity
                               when p_li_active then public.app_today() else null end,
      sender            = case when p_from_status = 'li_check' then sender else coalesce(sender, p_sender) end
  where id = p_lead_id and status = p_from_status;
  if not found then
    raise exception 'Lead % is not in status % any more. Reload.', p_lead_id, p_from_status;
  end if;
  insert into public.activity (lead_id, from_status, to_status, template_key, version, text_sent, sender)
  values (p_lead_id, p_from_status, p_to_status, p_template_key, p_version, p_text_sent,
          case when p_from_status = 'li_check' then null else p_sender end);
end $$;
revoke all on function public.record_step(uuid, text, text, date, text, text, text, boolean, boolean, text) from public, anon;
grant execute on function public.record_step(uuid, text, text, date, text, text, text, boolean, boolean, text) to authenticated;

-- 4. Queue: same rules as before, now with the lead's sender and its company's owner profile
--    (company_sender), so each profile tab shows its own leads plus the unclaimed ones it may take.
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
         end as company_slot,
         (select max(s.sender) from public.leads s
          where s.sender is not null and lower(trim(s.company_name)) = lower(trim(l.company_name))) as company_sender
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
