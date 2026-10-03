export function allocateShares(amountCents: number, weights: number[]): number[] {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new RangeError(`amountCents must be a positive integer, got ${amountCents}`);
  }
  if (weights.length === 0 || weights.some((weight) => !Number.isInteger(weight) || weight <= 0)) {
    throw new RangeError('weights must be a non-empty list of positive whole numbers');
  }

  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  const shares = weights.map((weight) => Math.floor((amountCents * weight) / totalWeight));
  const spare = amountCents - shares.reduce((total, share) => total + share, 0);

  // Hand out the cents lost to rounding, largest remainder first.
  const byRemainder = weights
    .map((weight, index) => ({ index, remainder: (amountCents * weight) % totalWeight }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of byRemainder.slice(0, spare)) shares[index] += 1;

  return shares;
}

const TIDY_STEPS_CENTS = [500, 100, 1];

/** Like allocateShares, but in the largest round step that still gives every check something. */
export function tidyShares(amountCents: number, weights: number[]): number[] {
  for (const step of TIDY_STEPS_CENTS) {
    if (amountCents % step !== 0) continue;
    const shares = allocateShares(amountCents / step, weights).map((units) => units * step);
    if (shares.every((share) => share > 0)) return shares;
  }
  return allocateShares(amountCents, weights);
}
