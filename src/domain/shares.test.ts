import { describe, expect, it } from 'vitest';
import { allocateShares, tidyShares } from './shares';

describe('allocateShares', () => {
  it('splits an amount in proportion to the weights', () => {
    expect(allocateShares(60000, [3, 3, 2, 2, 2])).toEqual([15000, 15000, 10000, 10000, 10000]);
  });

  it('gives spare cents to the earliest of equal checks', () => {
    expect(allocateShares(10000, [1, 1, 1])).toEqual([3334, 3333, 3333]);
  });

  it('gives a spare cent to the check that was rounded down the most', () => {
    expect(allocateShares(100, [1, 2])).toEqual([33, 67]);
  });

  it('always totals the amount exactly', () => {
    for (const amount of [100, 101, 99999, 120000]) {
      const shares = allocateShares(amount, [7, 3, 3, 1, 10, 4]);
      expect(shares.reduce((total, share) => total + share, 0)).toBe(amount);
    }
  });

  it('rejects an empty list, a zero weight and a fractional amount', () => {
    expect(() => allocateShares(1000, [])).toThrow(RangeError);
    expect(() => allocateShares(1000, [1, 0])).toThrow(RangeError);
    expect(() => allocateShares(10.5, [1])).toThrow(RangeError);
  });
});

describe('tidyShares', () => {
  it('lands on five-dollar steps when the amount allows', () => {
    expect(tidyShares(60000, [9, 10, 6, 7, 7, 8, 8, 7])).toEqual([8500, 9500, 6000, 7000, 7000, 7500, 7500, 7000]);
    expect(tidyShares(90000, [3, 3, 2, 2, 2])).toEqual([22500, 22500, 15000, 15000, 15000]);
  });

  it('falls back to whole dollars, then cents, so that no check gets nothing', () => {
    expect(tidyShares(1200, [10, 1, 1])).toEqual([1000, 100, 100]);
    expect(tidyShares(150, [1, 1])).toEqual([75, 75]);
  });

  it('always totals the amount exactly', () => {
    for (const amount of [100, 4550, 60000, 99999]) {
      const shares = tidyShares(amount, [7, 3, 3, 1, 10, 4]);
      expect(shares.reduce((total, share) => total + share, 0)).toBe(amount);
      expect(shares.every((share) => share > 0)).toBe(true);
    }
  });
});
