import { describe, expect, it } from 'vitest';
import { appKey, capFounders, csvToAppLeads, isReadyApp, normalizeXUrl, prepareAppLeads } from './leads';
import { messageType, queueScore, renderMessage, type Lead, type Template } from './outreach';

const header = [
  'founder_name', 'founder_title', 'linkedin_url', 'x_url', 'instagram_url', 'email', 'email_source', 'email_type',
  'email_alt', 'app_name', 'app_store_url', 'rating_count', 'avg_rating', 'genre', 'release_date', 'website',
  'crunchbase_url', 'tiktok_handle_found', 'yc_batch', 'source', 'extra_col',
];
const row = (o: Record<string, string>) => header.map((h) => o[h] ?? '');

describe('apps CSV', () => {
  it('maps founder and app columns', () => {
    const [l] = csvToAppLeads([
      header,
      row({
        founder_name: 'Jane Doe', founder_title: 'CEO', linkedin_url: 'linkedin.com/in/janedoe/', x_url: '@JaneD',
        email: 'Jane@Acme.app', email_type: 'personal', app_name: 'Acme', rating_count: '12,345', avg_rating: '4.7',
        app_store_url: 'https://apps.apple.com/us/app/acme/id123456?l=en', release_date: '2024-02-01',
        tiktok_handle_found: '@acme', website: 'acme.app', extra_col: 'hello',
      }),
    ]);
    expect(l.full_name).toBe('Jane Doe');
    expect(l.first_name).toBe('Jane');
    expect(l.title).toBe('CEO');
    expect(l.company_name).toBe('Acme');
    expect(l.x_url).toBe('https://x.com/janed');
    expect(l.email).toBe('jane@acme.app');
    expect(l.company_website).toBe('acme.app');
    expect(l.app).toMatchObject({
      app_name: 'Acme', rating_count: 12345, avg_rating: 4.7, release_date: '2024-02-01', tiktok_handle: '@acme',
      app_store_url: 'https://apps.apple.com/us/app/acme/id123456',
    });
    expect(l.notes).toBe('extra_col: hello');
  });

  it('notes bad values instead of failing', () => {
    const [l] = csvToAppLeads([header, row({ founder_name: 'Jo', email: 'not-an-email', app_name: 'X', rating_count: '12k' })]);
    expect(l.email).toBeUndefined();
    expect(l.app?.rating_count).toBeUndefined();
    expect(l.notes).toContain('email not an email address');
    expect(l.notes).toContain('rating_count not a plain number');
  });

  it('requires founder_name and a contact column', () => {
    expect(() => csvToAppLeads([['app_name', 'email']])).toThrow(/founder_name/);
    expect(() => csvToAppLeads([['founder_name', 'app_name']])).toThrow(/contact/);
  });
});

describe('apps dedupe and cap', () => {
  it('normalizes X handles and URLs', () => {
    expect(normalizeXUrl('https://twitter.com/Jane_D?s=20')).toBe('https://x.com/jane_d');
    expect(normalizeXUrl('x.com/jane')).toBe('https://x.com/jane');
  });

  it('keys apps on the App Store id, so country paths match', () => {
    expect(appKey({ app_store_url: 'https://apps.apple.com/us/app/acme/id123' })).toBe('apple:123');
    expect(appKey({ app_store_url: 'https://apps.apple.com/gb/app/acme-x/id123?l=en' })).toBe('apple:123');
    expect(appKey({ app_store_url: 'https://play.google.com/store/apps/details?id=com.Acme&hl=en' })).toBe('play:com.acme');
    expect(appKey({ app_name: ' Acme ' })).toBe('name:acme');
    expect(appKey(undefined)).toBeNull();
  });

  it('skips rows without founder or contact and duplicate founders', () => {
    const { valid, noFounder, duplicatesInFile } = prepareAppLeads([
      { linkedin_url: 'https://www.linkedin.com/in/a', first_name: 'A' },
      { linkedin_url: 'linkedin.com/in/a/', first_name: 'A' },
      { linkedin_url: null, first_name: 'B' },
      { linkedin_url: null, email: 'c@x.io' },
      { linkedin_url: null, first_name: 'D', x_url: 'https://x.com/d' },
    ]);
    expect(valid.map((l) => l.first_name)).toEqual(['A', 'D']);
    expect(noFounder).toBe(2);
    expect(duplicatesInFile).toBe(1);
  });

  it('keeps max 2 founders per app, counting founders already in the CRM', () => {
    const app = { app_name: 'Acme', app_store_url: 'https://apps.apple.com/us/app/acme/id1' };
    const rows = ['a', 'b', 'c'].map((n) => ({ linkedin_url: `https://www.linkedin.com/in/${n}`, first_name: n, app }));
    expect(capFounders(rows, new Map(), () => false)).toMatchObject({ overCap: 1 });
    const withOne = capFounders(rows, new Map([['apple:1', 1]]), () => false);
    expect(withOne.kept.map((r) => r.first_name)).toEqual(['a']);
    // An existing founder (update) always passes.
    const update = capFounders(rows, new Map([['apple:1', 2]]), (r) => r.first_name === 'c');
    expect(update.kept.map((r) => r.first_name)).toEqual(['c']);
  });

  it('ready = founder name + LinkedIn, email or X', () => {
    expect(isReadyApp({ first_name: 'A', linkedin_url: null, email: 'a@x.io' })).toBe(true);
    expect(isReadyApp({ first_name: 'A', linkedin_url: null, x_url: 'https://x.com/a' })).toBe(true);
    expect(isReadyApp({ first_name: 'A', linkedin_url: null })).toBe(false);
    expect(isReadyApp({ first_name: '', linkedin_url: 'https://www.linkedin.com/in/a' })).toBe(false);
  });
});

describe('apps outreach', () => {
  const lead: Lead = {
    id: 'l1', first_name: 'Jane', company_name: 'Acme Inc', company_type: 'app', status: 'follow_up_sent',
    next_action_at: '2026-11-27', top_artist_listeners: null, last_li_activity: null, li_checked_at: null,
  };

  it('message type and flat score', () => {
    expect(messageType('app')).toBe('app');
    expect(queueScore(lead, '2026-11-27')).toBe(15);
  });

  it('fills {firstName} {company} {app_name}', () => {
    const t: Template = {
      key: 'breakup_app', version: 'A', status: 'follow_up_sent', audience: 'app', title: '', active: true,
      body: 'Hi {firstName}, {app_name} at {company}?',
    };
    const { text, check } = renderMessage(t, lead, null, { app_name: 'Acme', rating_count: 10, genre: null });
    expect(text).toBe('Hi Jane, Acme at Acme Inc?');
    expect(check.canCopy).toBe(true);
    expect(renderMessage(t, lead, null, null).check.canCopy).toBe(false); // no app: {app_name} unfilled
  });
});
