import { RESEARCH_CSV_HEADER, toCsvLine } from '@/lib/leads';
import { createClient } from '@/lib/supabase/server';

// CSV exports for external researchers (see the research guide):
//   /export?type=skip                     every lead: never research these people/companies again
//   /export?type=backlog&country=US&...   unresearched leads in the researcher CSV format + lead_id,
//                                         to be filled in and uploaded back (the upload updates them)

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function all(build: (from: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>) {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

function csvResponse(name: string, lines: string[]) {
  return new Response('﻿' + lines.join('\n') + '\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
    },
  });
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Sign in first', { status: 401 });

  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  const today = new Date().toISOString().slice(0, 10);

  if (type === 'skip') {
    const rows = await all((from) =>
      supabase
        .from('leads')
        .select('linkedin_url, full_name, company_name, company_type, research_status, disqualify_reason')
        .order('company_name')
        .range(from, from + 999),
    );
    const header = ['linkedin_url', 'full_name', 'company_name', 'company_type', 'research_status', 'disqualify_reason'];
    return csvResponse(`crm_skip_list_${today}.csv`, [
      toCsvLine(header),
      ...rows.map((r) => toCsvLine(header.map((h) => r[h]))),
    ]);
  }

  if (type === 'backlog') {
    const country = (url.searchParams.get('country') ?? '').trim().toUpperCase();
    const companyType = (url.searchParams.get('company_type') ?? '').trim();
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 1000);
    const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);

    let query = supabase
      .from('leads')
      .select('id, linkedin_url, full_name, first_name, title, company_name, company_type, company_website, company_socials, email, country, notes')
      .in('research_status', ['new', 'artists_found', 'enriched'])
      .in('company_type', companyType ? [companyType] : ['label', 'management', 'agency', 'other'])
      .order('linkedin_url', { ascending: true, nullsFirst: false })
      .order('created_at')
      .range(offset, offset + limit - 1);
    if (country) query = query.eq('country', country);
    const { data, error } = await query;
    if (error) return new Response(error.message, { status: 500 });

    // Already decided by research (no profile found, duplicate) or demo data: not worth a pass.
    const rows: Row[] = (data ?? []).filter((r) => !/^(NO MATCH|DUPLICATE|DEMO LEAD)/.test(r.notes ?? ''));
    const header = ['lead_id', ...RESEARCH_CSV_HEADER, 'crm_notes'];
    const lines = rows.map((r) =>
      toCsvLine(
        header.map((h) => {
          if (h === 'lead_id') return r.id;
          if (h === 'company_linkedin') return r.company_socials;
          if (h === 'crm_notes') return r.notes;
          return h in r && h !== 'notes' ? r[h] : '';
        }),
      ),
    );
    const parts = ['crm_backlog', country || 'all', companyType || 'all', `from${offset}`, today].join('_');
    return csvResponse(`${parts}.csv`, [toCsvLine(header), ...lines]);
  }

  return new Response('Unknown export type. Use ?type=skip or ?type=backlog', { status: 400 });
}
