import { describe, expect, it } from 'vitest';
import { formatMoney } from './money';

describe('formatMoney', () => {
  it('formats whole dollars with two decimals', () => {
    expect(formatMoney(60000)).toBe('$600.00');
  });

  it('adds thousands separators', () => {
    expect(formatMoney(120000)).toBe('$1,200.00');
  });

  it('formats zero and amounts under a dollar', () => {
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(5)).toBe('$0.05');
  });

  it('rejects amounts that are not whole cents', () => {
    expect(() => formatMoney(10.5)).toThrow(RangeError);
  });
});
