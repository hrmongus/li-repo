-- Drop anything after the profile slug (/en, /details/...), matching lib/leads.ts.
create or replace function public.normalize_linkedin_url(url text) returns text
language sql immutable
as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(lower(trim(url)), '[?#].*$', ''),
               '^(https?://)?([a-z]{2,3}\.)?(www\.)?linkedin\.com', 'https://www.linkedin.com'),
             '^(https://www\.linkedin\.com/in/[^/]+)/.*$', '\1'),
           '/+$', '')
$$;
