export interface CriterionOutcome {
  /** A positive whole number. */
  weight: number;
  outcome: 'approved' | 'failed' | 'undecided';
}

export interface Split {
  freelancerCents: number;
  clientCents: number;
  approvedWeight: number;
  decidedWeight: number;
}

/**
 * Splits a milestone amount by the weight of approved checks over decided checks.
 * Undecided checks count for neither side. The freelancer share is rounded down
 * to the cent and the client gets the remainder.
 */
export function proposeSplit(amountCents: number, criteria: CriterionOutcome[]): Split {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new RangeError(`amountCents must be a non-negative integer, got ${amountCents}`);
  }

  let approvedWeight = 0;
  let decidedWeight = 0;
  for (const criterion of criteria) {
    if (!Number.isInteger(criterion.weight) || criterion.weight < 1) {
      throw new RangeError(`weight must be a positive integer, got ${criterion.weight}`);
    }
    if (criterion.outcome === 'undecided') continue;
    decidedWeight += criterion.weight;
    if (criterion.outcome === 'approved') approvedWeight += criterion.weight;
  }

  const freelancerCents =
    decidedWeight === 0 ? 0 : Math.floor((amountCents * approvedWeight) / decidedWeight);

  return {
    freelancerCents,
    clientCents: amountCents - freelancerCents,
    approvedWeight,
    decidedWeight,
  };
}
