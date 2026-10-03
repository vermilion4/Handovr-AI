const FEE_PER_MILLE = 29;
const FEE_FIXED_CENTS = 30;

export const HOLD_DAYS = 29;
export const RENEW_ON_DAY = 25;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The smallest hold that still leaves the milestone amount after PayPal takes its fee. */
export function holdTotalCents(amountCents: number): number {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new RangeError(`amountCents must be a positive integer, got ${amountCents}`);
  }
  let total = Math.ceil(((amountCents + FEE_FIXED_CENTS) * 1000) / (1000 - FEE_PER_MILLE));
  const net = (cents: number) => cents - Math.round((cents * FEE_PER_MILLE) / 1000) - FEE_FIXED_CENTS;
  while (net(total - 1) >= amountCents) total -= 1;
  while (net(total) < amountCents) total += 1;
  return total;
}

export function holdFeeCents(amountCents: number): number {
  return holdTotalCents(amountCents) - amountCents;
}

export function holdAction(
  hold: { authorizedAt: Date; expiresAt: Date; renewedAt: Date | null },
  now: Date,
): 'none' | 'renew' | 'expire' {
  if (now.getTime() >= hold.expiresAt.getTime()) return 'expire';
  const renewFrom = hold.authorizedAt.getTime() + RENEW_ON_DAY * DAY_MS;
  return hold.renewedAt === null && now.getTime() >= renewFrom ? 'renew' : 'none';
}
