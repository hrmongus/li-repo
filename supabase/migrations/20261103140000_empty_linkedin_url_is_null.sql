-- Empty LinkedIn URL or email (e.g. from a CSV import) is stored as NULL, so the unique
-- constraint on linkedin_url only applies to real URLs.
create or replace function public.leads_normalize_url() returns trigger
language plpgsql
as $$
begin
  new.linkedin_url := nullif(public.normalize_linkedin_url(new.linkedin_url), '');
  new.email := nullif(trim(new.email), '');
  return new;
end $$;

drop trigger leads_normalize_url on public.leads;
create trigger leads_normalize_url
before insert or update of linkedin_url, email on public.leads
for each row execute function public.leads_normalize_url();
