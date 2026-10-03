import { formatMoney } from './money';
import type { AiVerdict, ClientDecision } from './verification';

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

export type FinalOutcome = 'approved' | 'failed' | 'undecided';

export function finalOutcome(ai: AiVerdict | null, client: ClientDecision | null): FinalOutcome {
  if (client) return client === 'approved' ? 'approved' : 'failed';
  if (ai === 'pass') return 'approved';
  if (ai === 'fail') return 'failed';
  return 'undecided';
}

export interface SettlementCheck {
  description: string;
  shareCents: number;
  outcome: FinalOutcome;
}

function joined(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** A plain account of a split, used until Claude's explanation replaces it and whenever Claude is unavailable. */
export function explainSplit(amountCents: number, checks: SettlementCheck[], split: Split): string {
  const decided = checks.filter((check) => check.outcome !== 'undecided');
  const passed = decided.filter((check) => check.outcome === 'approved');
  const failed = decided.filter((check) => check.outcome === 'failed');
  const undecided = checks.filter((check) => check.outcome === 'undecided');
  const whole = formatMoney(amountCents);

  if (decided.length === 0) return `No check was decided, so nothing is paid and the full ${whole} goes back to the client.`;

  const parts: string[] = [];
  if (passed.length === 0) {
    parts.push(`None of the ${decided.length} checks that were decided passed, so nothing is paid and the full ${whole} goes back to the client.`);
  } else {
    const percent = Math.round((split.approvedWeight * 100) / split.decidedWeight);
    parts.push(
      `${passed.length} of the ${decided.length} checks that were decided passed. They are worth ${formatMoney(split.approvedWeight)} of the ${formatMoney(split.decidedWeight)} that was decided, which is ${percent}%, so ${formatMoney(split.freelancerCents)} of the ${whole} goes to the freelancer and ${formatMoney(split.clientCents)} goes back to the client.`,
    );
  }
  if (failed.length > 0) parts.push(`Not met: ${joined(failed.map((check) => check.description))}.`);
  if (undecided.length === 1) parts.push(`${undecided[0].description} was never decided, so it is left out.`);
  if (undecided.length > 1) parts.push(`${joined(undecided.map((check) => check.description))} were never decided, so they are left out.`);
  return parts.join(' ');
}

/** What the freelancer is paid: the agreed share after a split, otherwise the whole milestone. */
export function paidCents(milestone: { amountCents: number; splitFreelancerCents: number | null }): number {
  return milestone.splitFreelancerCents ?? milestone.amountCents;
}
