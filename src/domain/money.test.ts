import { describe, expect, it } from 'vitest';
import { formatUsd } from './money';

describe('formatUsd', () => {
  it('formats whole dollars with two decimals', () => {
    expect(formatUsd(60000)).toBe('$600.00');
  });

  it('adds thousands separators', () => {
    expect(formatUsd(120000)).toBe('$1,200.00');
  });

  it('formats zero and amounts under a dollar', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(5)).toBe('$0.05');
  });

  it('rejects amounts that are not whole cents', () => {
    expect(() => formatUsd(10.5)).toThrow(RangeError);
  });
});
