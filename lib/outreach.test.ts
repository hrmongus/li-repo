import { describe, expect, it } from 'vitest';
import { addDays, pickVersion, queueScore } from './outreach';

const today = '2026-11-04';

const lead = (over: Partial<Parameters<typeof queueScore>[0]> = {}) => ({
  status: 'connected',
  next_action_at: today,
  company_type: 'label' as const,
  top_artist_listeners: 50_000,
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
