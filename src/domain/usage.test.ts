import { describe, expect, it } from 'vitest';
import { allowance, limitsFrom, startOfDay } from './usage';

const limits = limitsFrom({});
const now = new Date('2026-11-20T15:30:00Z');

describe('limitsFrom', () => {
  it('has defaults and reads overrides', () => {
    expect(limits).toEqual({ perUser: { draft: 8, rewrite: 20, verify: 6 }, total: 150 });
    expect(limitsFrom({ AI_LIMIT_VERIFY: '2', AI_LIMIT_TOTAL: 'lots' })).toEqual({ perUser: { draft: 8, rewrite: 20, verify: 2 }, total: 150 });
  });
});

describe('startOfDay', () => {
  it('is midnight UTC of the same day', () => {
    expect(startOfDay(now)).toEqual(new Date('2026-11-20T00:00:00Z'));
  });
});

describe('allowance', () => {
  it('allows use under both limits', () => {
    expect(allowance({ kind: 'verify', usedByUser: 5, usedToday: 149, limits, now })).toEqual({ ok: true });
  });

  it("refuses a person who used today's share, saying when to try again", () => {
    expect(allowance({ kind: 'verify', usedByUser: 6, usedToday: 10, limits, now })).toEqual({
      ok: false,
      message: "You have used today's 6 test runs. Try again after midnight UTC, in 9 hours.",
    });
  });

  it('refuses everyone once the day is used up', () => {
    expect(allowance({ kind: 'draft', usedByUser: 0, usedToday: 150, limits, now })).toEqual({
      ok: false,
      message: 'Handovr has reached its AI limit for today. Try again after midnight UTC, in 9 hours.',
    });
  });

  it('says one hour in the last hour of the day', () => {
    const late = new Date('2026-11-20T23:30:00Z');
    expect(allowance({ kind: 'rewrite', usedByUser: 20, usedToday: 20, limits, now: late })).toEqual({
      ok: false,
      message: "You have used today's 20 rewrites. Try again after midnight UTC, in 1 hour.",
    });
  });
});
