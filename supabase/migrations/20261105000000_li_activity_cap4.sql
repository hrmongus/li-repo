-- LinkedIn activity per lead, and a company cap of 4 that fills slots with the most active people.

alter table public.leads
  add column last_li_activity date,  -- last post, repost or comment; null = none found
  add column li_checked_at date;     -- when research checked; null = not checked yet

-- Recreated (not replaced): l.* now has more columns.
drop view public.queue;
create view public.queue with (security_invoker = true) as
with active as (
  select l.*,
         row_number() over (
           partition by lower(trim(l.company_name))
           order by (l.status <> 'to_do') desc,                  -- in-progress contacts keep their slot
                    case when l.li_checked_at is null then 2      -- not checked yet
                         when l.last_li_activity is null then 3   -- never posted: last by far
                         when l.last_li_activity >= public.app_today() - 90 then 0
                         else 1 end,                              -- older activity beats none
                    l.last_li_activity desc nulls last,           -- most recent first
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
where a.company_slot <= 4
  and a.status <> 'won'
  and a.linkedin_url is not null
  and a.next_action_at is not null and a.next_action_at <= public.app_today();
