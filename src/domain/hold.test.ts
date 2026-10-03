import { describe, expect, it } from 'vitest';
import { holdAction, holdFeeCents, holdTotalCents } from './hold';

// PayPal's fee on a capture: 2.9% rounded to the cent, plus 30 cents.
const paypalFee = (capturedCents: number) => Math.round((capturedCents * 29) / 1000) + 30;

describe('holdTotalCents', () => {
  it('matches the amounts measured in the sandbox', () => {
    expect(holdTotalCents(60000)).toBe(61823);
    expect(holdFeeCents(60000)).toBe(1823);
  });

  it('always leaves at least the milestone amount after the fee, and never a cent more than needed', () => {
    for (const amount of [100, 101, 999, 4550, 10000, 36000, 60000, 99999, 120000, 5000000]) {
      const total = holdTotalCents(amount);
      expect(total - paypalFee(total)).toBeGreaterThanOrEqual(amount);
      expect(total - 1 - paypalFee(total - 1)).toBeLessThan(amount);
    }
  });

  it('rejects an amount that is not a positive whole number of cents', () => {
    for (const amount of [0, -100, 10.5]) expect(() => holdTotalCents(amount)).toThrow(RangeError);
  });
});

describe('holdAction', () => {
  const authorizedAt = new Date('2026-10-01T12:00:00Z');
  const day = (n: number) => new Date(authorizedAt.getTime() + n * 24 * 60 * 60 * 1000);
  const fresh = { authorizedAt, expiresAt: day(29), renewedAt: null };

  it('does nothing before day 25', () => {
    expect(holdAction(fresh, day(0))).toBe('none');
    expect(holdAction(fresh, day(24.9))).toBe('none');
  });

  it('renews once from day 25', () => {
    expect(holdAction(fresh, day(25))).toBe('renew');
    expect(holdAction(fresh, day(28.9))).toBe('renew');
  });

  it('does not renew a hold that was already renewed', () => {
    const renewed = { authorizedAt, expiresAt: day(54), renewedAt: day(25) };
    expect(holdAction(renewed, day(40))).toBe('none');
    expect(holdAction(renewed, day(53.9))).toBe('none');
  });

  it('expires at the expiry time, renewed or not', () => {
    expect(holdAction(fresh, day(29))).toBe('expire');
    expect(holdAction({ authorizedAt, expiresAt: day(54), renewedAt: day(25) }, day(54))).toBe('expire');
  });
});
