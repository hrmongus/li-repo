import { describe, expect, it } from 'vitest';
import { addDays, dayStartUtc, inTab, onHold, pickVersion, queueScore, SENDERS, type HoldLead } from './outreach';

describe('inTab (sender profiles)', () => {
  const lead = (status: string, sender: string | null, company_sender: string | null = sender) => ({ status, sender, company_sender });

  it('LinkedIn check tab shows only li_check leads; profile tabs never do', () => {
    expect(inTab(lead('li_check', null), 'li_check')).toBe(true);
    expect(inTab(lead('li_check', null), 'Narek')).toBe(false);
    expect(inTab(lead('to_do', null), 'li_check')).toBe(false);
  });

  it('owned leads show only in their owner tab', () => {
    expect(inTab(lead('connected', 'Narek'), 'Narek')).toBe(true);
    expect(inTab(lead('connected', 'Narek'), 'Andrej')).toBe(false);
  });

  it('unclaimed warm-ups show in every tab unless the company already has a profile', () => {
    expect(SENDERS.every((s) => inTab(lead('to_do', null, null), s.name))).toBe(true);
    expect(inTab(lead('to_do', null, 'Mher'), 'Mher')).toBe(true);
    expect(inTab(lead('to_do', null, 'Mher'), 'Narek')).toBe(false);
  });

  it('Andrej has a 20/day limit, the others 15', () => {
    expect(SENDERS.map((s) => [s.name, s.dailyLimit])).toEqual([['Andrej', 20], ['Narek', 15], ['Mher', 15]]);
  });
});

describe('onHold (active first, inactive only if that did not work)', () => {
  const l = (id: string, status: string, active: boolean | null, company = 'Acme Records'): HoldLead => ({
    id, company_name: company, status,
    li_checked_at: active === null ? null : '2026-11-01',
    last_li_activity: active ? '2026-11-01' : null,
  });
  const inactive = l('i', 'warmed_up', false);

  it('holds an uninvited inactive contact while an active colleague is still in play', () => {
    expect(onHold(inactive, [inactive, l('a', 'connection_requested', true)])).toBe(true);
    expect(onHold(inactive, [inactive, l('u', 'li_check', null)])).toBe(true); // unchecked counts as not inactive
  });

  it('releases it once the active colleagues failed, or when there is no active colleague', () => {
    expect(onHold(inactive, [inactive, l('a', 'no_reply', true), l('b', 'not_accepted', true)])).toBe(false);
    expect(onHold(inactive, [inactive, l('j', 'warmed_up', false)])).toBe(false);
    expect(onHold(inactive, [inactive, l('a', 'to_do', true, 'Other Records')])).toBe(false);
  });

  it('never holds active leads or inactive leads already invited', () => {
    expect(onHold(l('a', 'warmed_up', true), [l('b', 'to_do', true)])).toBe(false);
    expect(onHold(l('i2', 'connection_requested', false), [l('a', 'to_do', true)])).toBe(false);
  });
});

describe('dayStartUtc', () => {
  it('is Bratislava midnight in winter (UTC+1) and summer (UTC+2)', () => {
    expect(dayStartUtc('2026-11-07')).toBe('2026-11-06T23:00:00.000Z');
    expect(dayStartUtc('2026-07-01')).toBe('2026-06-30T22:00:00.000Z');
  });
});

const today = '2026-11-04';

const lead = (over: Partial<Parameters<typeof queueScore>[0]> = {}) => ({
  status: 'connected',
  next_action_at: today,
  company_type: 'label' as const,
  top_artist_listeners: 50_000,
  last_li_activity: null,
  li_checked_at: null,
  ...over,
});

describe('queueScore', () => {
  it('scores labels and management by top_artist_listeners', () => {
    expect(queueScore(lead({ top_artist_listeners: 3_900_000 }), today)).toBe(30);
    expect(queueScore(lead({ top_artist_listeners: 1_000_000 }), today)).toBe(30);
    expect(queueScore(lead({ top_artist_listeners: 999_999 }), today)).toBe(25);
    expect(queueScore(lead({ top_artist_listeners: 100_000 }), today)).toBe(25);
    expect(queueScore(lead({ top_artist_listeners: 99_999, company_type: 'management' }), today)).toBe(15);
    expect(queueScore(lead({ top_artist_listeners: 10_000 }), today)).toBe(15);
  });

  it('gives agencies a flat 15', () => {
    expect(queueScore(lead({ company_type: 'agency', top_artist_listeners: null }), today)).toBe(15);
  });

  it('adds 2 per overdue day, max 10', () => {
    expect(queueScore(lead({ next_action_at: addDays(today, -1) }), today)).toBe(17);
    expect(queueScore(lead({ next_action_at: addDays(today, -5) }), today)).toBe(25);
    expect(queueScore(lead({ next_action_at: addDays(today, -30) }), today)).toBe(25);
    expect(queueScore(lead({ next_action_at: addDays(today, 2) }), today)).toBe(15);
  });

  it('ranks LinkedIn activity: recent > older > not checked > never posted', () => {
    const checked = { li_checked_at: today };
    const recent = queueScore(lead({ ...checked, last_li_activity: addDays(today, -10) }), today);
    const ninety = queueScore(lead({ ...checked, last_li_activity: addDays(today, -60) }), today);
    const sixMonths = queueScore(lead({ ...checked, last_li_activity: addDays(today, -180) }), today);
    const unchecked = queueScore(lead(), today);
    const never = queueScore(lead({ ...checked, last_li_activity: null }), today);
    expect([recent, ninety, sixMonths, unchecked, never]).toEqual([25, 20, 15, 15, -5]);
    // never posting is the lowest by far: below a weaker lead that posted six months ago
    const weakButPosted = queueScore(lead({ ...checked, last_li_activity: addDays(today, -180), top_artist_listeners: 10_000 }), today);
    const strongNever = queueScore(lead({ ...checked, top_artist_listeners: 3_000_000 }), today);
    expect(weakButPosted).toBeGreaterThan(strongNever);
  });

  it('puts replied leads above any non-replied lead', () => {
    const weakReplied = queueScore(lead({ status: 'replied', company_type: 'agency' }), today);
    const best = queueScore(lead({ top_artist_listeners: 3_000_000, next_action_at: addDays(today, -30) }), today);
    expect(best).toBe(40);
    expect(weakReplied).toBeGreaterThan(best);
  });
});

describe('pickVersion', () => {
  it('is stable for the same lead and key', () => {
    const v = pickVersion('lead-123', 'invite_label', ['A', 'B']);
    for (let i = 0; i < 10; i++) expect(pickVersion('lead-123', 'invite_label', ['A', 'B'])).toBe(v);
  });

  it('splits about 50/50 across leads', () => {
    let a = 0;
    const n = 10_000;
    for (let i = 0; i < n; i++) {
      if (pickVersion(crypto.randomUUID(), 'invite_label', ['A', 'B']) === 'A') a++;
    }
    expect(a / n).toBeGreaterThan(0.47);
    expect(a / n).toBeLessThan(0.53);
  });

  it('assigns each template key independently', () => {
    let same = 0;
    const n = 2_000;
    for (let i = 0; i < n; i++) {
      const id = crypto.randomUUID();
      if (pickVersion(id, 'invite_label', ['A', 'B']) === pickVersion(id, 'invite_agency', ['A', 'B'])) same++;
    }
    expect(same / n).toBeGreaterThan(0.4);
    expect(same / n).toBeLessThan(0.6);
  });

  it('serves only active versions', () => {
    expect(pickVersion('any', 'msg1_label', ['A'])).toBe('A');
    expect(pickVersion('any', 'msg1_label', ['B'])).toBe('B');
    expect(pickVersion('any', 'msg1_label', [])).toBeNull();
  });
});
