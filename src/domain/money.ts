export const CURRENCY = 'CAD';

const formatter = new Intl.NumberFormat('en-CA', { style: 'currency', currency: CURRENCY });

export function formatMoney(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new RangeError(`cents must be an integer, got ${cents}`);
  }
  return formatter.format(cents / 100);
}

export function parseAmount(text: string): number | null {
  const cleaned = text.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [dollars, decimals = ''] = cleaned.split('.');
  const cents = Number(dollars) * 100 + Number(decimals.padEnd(2, '0'));
  return cents > 0 ? cents : null;
}
