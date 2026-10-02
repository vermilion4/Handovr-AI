export const CURRENCY = 'CAD';

const formatter = new Intl.NumberFormat('en-CA', { style: 'currency', currency: CURRENCY });

export function formatMoney(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new RangeError(`cents must be an integer, got ${cents}`);
  }
  return formatter.format(cents / 100);
}
