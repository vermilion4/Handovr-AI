import { describe, expect, it } from 'vitest';
import { formatMoney, parseAmount } from './money';

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

describe('parseAmount', () => {
  it('reads plain and formatted dollar amounts as cents', () => {
    expect(parseAmount('600')).toBe(60000);
    expect(parseAmount('600.5')).toBe(60050);
    expect(parseAmount('$1,200.00')).toBe(120000);
    expect(parseAmount(' 45.07 ')).toBe(4507);
  });

  it('rejects anything that is not a positive amount with at most two decimals', () => {
    for (const text of ['', 'abc', '-5', '0', '0.00', '10.999', '1e3', '12.']) {
      expect(parseAmount(text)).toBeNull();
    }
  });
});
