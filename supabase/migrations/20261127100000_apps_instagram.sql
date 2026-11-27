-- Apps vertical: Instagram as a second outreach channel, in parallel to LinkedIn on the same lead.
-- One shared Instagram profile (no sender profiles, no VA check). A lead is in the Instagram
-- sequence when it has a founder Instagram (leads.instagram_url) or a company Instagram
-- (leads.company_instagram_url). Its Instagram progress is ig_status (set to ig_comment by a
-- trigger as soon as an Instagram link is there; null = not in the Instagram sequence), separate
-- from the LinkedIn status. Music is unchanged; the Instantly views are untouched.

-- 1. leads: company Instagram + Instagram progress.
alter table public.leads
  add column company_instagram_url text,
  add column ig_status text,
  add column ig_status_changed_at timestamptz,
  add column ig_next_action_at date;
alter table public.leads add constraint leads_ig_only_apps
  check (vertical = 'apps' or (ig_status is null and company_instagram_url is null));

-- 1b. Entering the Instagram sequence: an apps lead with an Instagram link starts at ig_comment,
--     due today. Works for uploads and for links added later in "Show all".
create function public.leads_start_instagram() returns trigger language plpgsql as $$
begin
  if new.vertical = 'apps' and new.ig_status is null
     and coalesce(new.instagram_url, new.company_instagram_url) is not null then
    new.ig_status := 'ig_comment';
    new.ig_next_action_at := public.app_today();
    new.ig_status_changed_at := now();
  end if;
  return new;
end $$;
create trigger leads_start_instagram
before insert or update of instagram_url, company_instagram_url, vertical on public.leads
for each row execute function public.leads_start_instagram();
update public.leads set ig_status = 'ig_comment', ig_next_action_at = public.app_today(), ig_status_changed_at = now()
where vertical = 'apps' and ig_status is null and coalesce(instagram_url, company_instagram_url) is not null;

-- 2. activity: which channel a click belongs to (existing rows are LinkedIn).
alter table public.activity add column channel text not null default 'li' check (channel in ('li', 'ig'));

-- 3. Ready gate: apps founders may also be reached only on Instagram.
create or replace function public.leads_check_ready() returns trigger language plpgsql as $$
begin
  if new.research_status = 'ready' and (tg_op = 'INSERT' or old.research_status is distinct from 'ready') then
    if new.company_type = 'app' then
      if coalesce(new.first_name, '') = '' then
        raise exception 'Lead % cannot be ready: needs the founder''s name', coalesce(new.full_name, new.id::text);
      end if;
      if coalesce(new.linkedin_url, '') = '' and coalesce(new.email, '') = '' and coalesce(new.x_url, '') = ''
         and coalesce(new.instagram_url, '') = '' and coalesce(new.company_instagram_url, '') = '' then
        raise exception 'Lead % cannot be ready: needs a LinkedIn URL, email, X or Instagram', coalesce(new.full_name, new.id::text);
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

-- 4. record_step gets p_channel. 'li' (default): exactly as before. 'ig': moves ig_status, no
--    sender profile, no LinkedIn check; "Plan sent" works the same.
drop function public.record_step(uuid, text, text, date, text, text, text, boolean, boolean, text);
create function public.record_step(
  p_lead_id uuid, p_from_status text, p_to_status text, p_next_action_at date,
  p_template_key text default null, p_version text default null, p_text_sent text default null,
  p_plan_sent boolean default false, p_li_active boolean default null, p_sender text default null,
  p_channel text default 'li'
) returns void language plpgsql security invoker set search_path = public as $$
declare
  v_owner text;
  v_company text;
  v_company_owner text;
begin
  if p_channel = 'ig' then
    update public.leads
    set ig_status            = p_to_status,
        ig_status_changed_at = case when ig_status is distinct from p_to_status then now() else ig_status_changed_at end,
        ig_next_action_at    = p_next_action_at,
        plan_sent_at         = case when p_plan_sent then now() else plan_sent_at end
    where id = p_lead_id and vertical = 'apps' and ig_status = p_from_status;
    if not found then
      raise exception 'Lead % is not at Instagram step % any more. Reload.', p_lead_id, p_from_status;
    end if;
    insert into public.activity (lead_id, from_status, to_status, template_key, version, text_sent, sender, channel)
    values (p_lead_id, p_from_status, p_to_status, p_template_key, p_version, p_text_sent, null, 'ig');
    return;
  end if;
  if p_channel <> 'li' then
    raise exception 'Unknown channel %', p_channel;
  end if;

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
  insert into public.activity (lead_id, from_status, to_status, template_key, version, text_sent, sender, channel)
  values (p_lead_id, p_from_status, p_to_status, p_template_key, p_version, p_text_sent,
          case when p_from_status = 'li_check' then null else p_sender end, 'li');
end $$;
revoke all on function public.record_step(uuid, text, text, date, text, text, text, boolean, boolean, text, text) from public, anon;
grant execute on function public.record_step(uuid, text, text, date, text, text, text, boolean, boolean, text, text) to authenticated;

-- 5. Instagram queue: ready apps leads with an Instagram link, due today or overdue, not final.
--    One lead per Instagram account (founders without their own Instagram share the company's):
--    the first lead worked on an account keeps it for good, so an account is never DMed twice.
create view public.ig_queue with (security_invoker = true) as
with base as (
  select l.*,
         coalesce(l.instagram_url, l.company_instagram_url) as ig_target,
         row_number() over (
           partition by lower(trim(coalesce(l.instagram_url, l.company_instagram_url)))
           order by (l.ig_status <> 'ig_comment') desc, l.ig_status_changed_at, l.created_at
         ) as ig_slot
  from public.leads l
  where l.vertical = 'apps'
    and l.research_status = 'ready'
    and l.ig_status is not null
    and coalesce(l.instagram_url, l.company_instagram_url) is not null
)
select b.*, ap.app_name, ap.app_store_url, ap.rating_count, ap.genre as app_genre, ap.tiktok_handle
from base b
left join public.apps ap on ap.lead_id = b.id and ap.is_primary
where b.ig_slot = 1
  and b.ig_status not in ('no_reply', 'won', 'lost')
  and b.ig_next_action_at is not null and b.ig_next_action_at <= public.app_today();

-- 5b. LinkedIn queue: also expose the company Instagram and the Instagram step (appended at the end),
--     so an apps card shows where the same lead is on Instagram. Rules unchanged.
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
       a.vertical, a.x_url, a.instagram_url as lead_instagram_url, a.crunchbase_url, a.email_type,
       ap.app_name, ap.app_store_url, ap.rating_count, ap.genre as app_genre, ap.tiktok_handle,
       -- appended: Instagram channel
       a.company_instagram_url, a.ig_status
from active a
left join public.artists ar on ar.lead_id = a.id and ar.is_primary
left join public.apps ap on ap.lead_id = a.id and ap.is_primary
where a.company_slot <= 4
  and a.status <> 'won'
  and a.linkedin_url is not null
  and a.next_action_at is not null and a.next_action_at <= public.app_today();

-- 6. A/B stats: a send's outcomes count only on its own channel (columns unchanged; LinkedIn
--    numbers are the same as before because every older activity row is LinkedIn).
create or replace view public.template_stats with (security_invoker = true) as
with sends as (
  select template_key, version, lead_id, channel, count(*) as times, min(created_at) as first_sent_at
  from public.activity where template_key is not null group by 1, 2, 3, 4
), outcomes as (
  select s.*,
    exists (select 1 from public.activity x where x.lead_id = s.lead_id and x.channel = s.channel
            and x.created_at > s.first_sent_at and x.to_status = 'connected') as connected,
    exists (select 1 from public.activity x where x.lead_id = s.lead_id and x.channel = s.channel
            and x.created_at > s.first_sent_at and x.to_status = 'replied' and x.from_status <> 'replied') as replied,
    exists (select 1 from public.activity x where x.lead_id = s.lead_id and x.channel = s.channel
            and x.created_at > s.first_sent_at and x.to_status = 'call_booked') as call_booked
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

-- 7. lead_counts: Instagram step (null = not in the Instagram sequence) and whether the lead has a
--    LinkedIn URL (apps founders may be Instagram-only), both appended.
create or replace view public.lead_counts with (security_invoker = true) as
select research_status, status, disqualify_reason, count(*)::int as n, vertical, ig_status,
       (linkedin_url is not null) as has_linkedin
from public.leads
group by research_status, status, disqualify_reason, vertical, ig_status, (linkedin_url is not null);

-- 8. Instagram DM templates (audience app; status = the Instagram step they're sent from).
--    Same content as supabase/seed.sql. Placeholders: {firstName} {company} {app_name}.
insert into public.message_templates (key, version, status, audience, title, body) values
('dm1_app_ig', 'A', 'ig_dm', 'app', 'Instagram DM 1: app',
$$Hey {firstName}, love what you're building with {app_name}. Quick one: have you tried faceless TikTok pages for it (fan-style pages posting short edits, nobody on camera)?

I sketched a page plan for {app_name} plus 3 sample edits. Want me to send it?$$),
('followup_app_ig', 'A', 'ig_dm_sent', 'app', 'Instagram follow-up: app',
$${firstName}, still happy to send the page plan and 3 sample edits for {app_name}. Just say yes and they're yours.$$)
on conflict (key, version) do nothing;
