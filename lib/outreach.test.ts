import { describe, expect, it } from 'vitest';
import { addDays, pickVersion, queueScore, type Artist } from './outreach';

const today = '2026-11-03';

const artist = (over: Partial<Artist> = {}): Artist => ({
  name: 'Test Artist',
  monthly_listeners: 50_000,
  latest_release_title: 'Old Song',
  next_release_title: null,
  next_release_date: null,
  tiktok_sound_videos: null,
  hook_line: null,
  samples_url: null,
  ...over,
});

const due = (over: { status?: string; next_action_at?: string | null } = {}) => ({
  status: 'connected',
  next_action_at: today,
  ...over,
});

describe('queueScore', () => {
  it('scores monthly listeners in three bands', () => {
    expect(queueScore(due(), artist({ monthly_listeners: 150_000 }), today)).toBe(30);
    expect(queueScore(due(), artist({ monthly_listeners: 100_000 }), today)).toBe(30);
    expect(queueScore(due(), artist({ monthly_listeners: 20_000 }), today)).toBe(20);
    expect(queueScore(due(), artist({ monthly_listeners: 19_999 }), today)).toBe(10);
  });

  it('adds 20 for a release 14–56 days away, inclusive', () => {
    const at = (days: number) => queueScore(due(), artist({ next_release_date: addDays(today, days) }), today);
    expect(at(13)).toBe(20);
    expect(at(14)).toBe(40);
    expect(at(56)).toBe(40);
    expect(at(57)).toBe(20);
  });

  it('adds 5 when tiktok_sound_videos is known, including 0', () => {
    expect(queueScore(due(), artist({ tiktok_sound_videos: 0 }), today)).toBe(25);
    expect(queueScore(due(), artist({ tiktok_sound_videos: 12_000 }), today)).toBe(25);
  });

  it('adds 2 per overdue day, max 10', () => {
    expect(queueScore(due({ next_action_at: addDays(today, -1) }), artist(), today)).toBe(22);
    expect(queueScore(due({ next_action_at: addDays(today, -5) }), artist(), today)).toBe(30);
    expect(queueScore(due({ next_action_at: addDays(today, -30) }), artist(), today)).toBe(30);
    expect(queueScore(due({ next_action_at: addDays(today, 2) }), artist(), today)).toBe(20);
  });

  it('puts replied leads above any non-replied lead', () => {
    const weakReplied = queueScore(due({ status: 'replied' }), artist({ monthly_listeners: 100 }), today);
    const best = queueScore(
      due({ next_action_at: addDays(today, -30) }),
      artist({ monthly_listeners: 5_000_000, next_release_date: addDays(today, 20), tiktok_sound_videos: 1 }),
      today,
    );
    expect(best).toBe(65);
    expect(weakReplied).toBeGreaterThan(best);
  });
});

describe('pickVersion', () => {
  it('is stable for the same lead and key', () => {
    const v = pickVersion('lead-123', 'msg1_label', ['A', 'B']);
    for (let i = 0; i < 10; i++) expect(pickVersion('lead-123', 'msg1_label', ['A', 'B'])).toBe(v);
  });

  it('splits about 50/50 across leads', () => {
    let a = 0;
    const n = 10_000;
    for (let i = 0; i < n; i++) {
      const id = crypto.randomUUID();
      if (pickVersion(id, 'msg1_label', ['A', 'B']) === 'A') a++;
    }
    expect(a / n).toBeGreaterThan(0.47);
    expect(a / n).toBeLessThan(0.53);
  });

  it('assigns each template key independently', () => {
    // If keys were ignored, every lead would get the same version for both keys.
    let same = 0;
    const n = 2_000;
    for (let i = 0; i < n; i++) {
      const id = crypto.randomUUID();
      if (pickVersion(id, 'invite_label', ['A', 'B']) === pickVersion(id, 'msg1_label', ['A', 'B'])) same++;
    }
    expect(same / n).toBeGreaterThan(0.4);
    expect(same / n).toBeLessThan(0.6);
  });

  it('serves only active versions', () => {
    expect(pickVersion('any', 'voice', ['A'])).toBe('A');
    expect(pickVersion('any', 'voice', ['B'])).toBe('B');
    expect(pickVersion('any', 'voice', [])).toBeNull();
  });
});
