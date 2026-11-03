-- Dashboard counts, computed in the database (the API returns at most 1000 rows per request).
create view public.lead_counts with (security_invoker = true) as
select research_status, status, count(*)::int as n
from public.leads
group by research_status, status;
