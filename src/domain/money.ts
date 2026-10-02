const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatUsd(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new RangeError(`cents must be an integer, got ${cents}`);
  }
  return usd.format(cents / 100);
}
