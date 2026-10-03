import { describe, expect, it } from 'vitest';
import { explainSplit, finalOutcome, paidCents, proposeSplit, type CriterionOutcome, type SettlementCheck } from './settlement';

const c = (weight: number, outcome: CriterionOutcome['outcome']): CriterionOutcome => ({ weight, outcome });

describe('proposeSplit', () => {
  it('matches the worked example in the spec', () => {
    const split = proposeSplit(60000, [
      c(3, 'approved'),
      c(3, 'approved'),
      c(2, 'failed'),
      c(2, 'approved'),
      c(2, 'undecided'),
    ]);
    expect(split).toEqual({
      freelancerCents: 48000,
      clientCents: 12000,
      approvedWeight: 8,
      decidedWeight: 10,
    });
  });

  it('rounds the freelancer share down and gives the remainder to the client', () => {
    const split = proposeSplit(10000, [c(1, 'approved'), c(1, 'approved'), c(1, 'failed')]);
    expect(split.freelancerCents).toBe(6666);
    expect(split.clientCents).toBe(3334);
    expect(split.freelancerCents + split.clientCents).toBe(10000);
  });

  it('pays nothing and returns everything when no check was decided', () => {
    const split = proposeSplit(60000, [c(3, 'undecided'), c(2, 'undecided')]);
    expect(split).toEqual({ freelancerCents: 0, clientCents: 60000, approvedWeight: 0, decidedWeight: 0 });
  });

  it('pays nothing when there are no checks at all', () => {
    expect(proposeSplit(60000, [])).toMatchObject({ freelancerCents: 0, clientCents: 60000 });
  });

  it('pays everything when every decided check was approved', () => {
    const split = proposeSplit(60000, [c(3, 'approved'), c(2, 'approved'), c(1, 'undecided')]);
    expect(split.freelancerCents).toBe(60000);
    expect(split.clientCents).toBe(0);
  });

  it('pays nothing when every decided check failed', () => {
    expect(proposeSplit(60000, [c(3, 'failed'), c(2, 'failed')]).freelancerCents).toBe(0);
  });

  it.each([-1, 10.5, Number.NaN])('rejects an amount of %s', (amount) => {
    expect(() => proposeSplit(amount, [c(1, 'approved')])).toThrow(RangeError);
  });

  it.each([0, -2, 1.5])('rejects a weight of %s', (weight) => {
    expect(() => proposeSplit(1000, [c(weight, 'approved')])).toThrow(RangeError);
  });
});

describe('finalOutcome', () => {
  it("takes the client's decision over the tester's verdict", () => {
    expect(finalOutcome('unclear', 'approved')).toBe('approved');
    expect(finalOutcome('pass', 'rejected')).toBe('failed');
  });

  it("uses the tester's verdict when the client did not decide", () => {
    expect(finalOutcome('pass', null)).toBe('approved');
    expect(finalOutcome('fail', null)).toBe('failed');
    expect(finalOutcome('unclear', null)).toBe('undecided');
    expect(finalOutcome(null, null)).toBe('undecided');
  });
});

describe('explainSplit', () => {
  const checks: SettlementCheck[] = [
    { description: 'The contact form sends a message', shareCents: 15000, outcome: 'approved' },
    { description: 'The page works at phone width', shareCents: 15000, outcome: 'approved' },
    { description: 'The page loads in under 3 seconds', shareCents: 10000, outcome: 'failed' },
    { description: 'No links on the page are broken', shareCents: 10000, outcome: 'approved' },
    { description: 'The page matches the look of the homepage', shareCents: 10000, outcome: 'undecided' },
  ];
  const splitOf = (list: SettlementCheck[]) => proposeSplit(60000, list.map((check) => ({ weight: check.shareCents, outcome: check.outcome })));

  it('says what passed, what it was worth and what was left out', () => {
    const split = splitOf(checks);
    expect(split.freelancerCents).toBe(48000);
    expect(explainSplit(60000, checks, split)).toBe(
      '3 of the 4 checks that were decided passed. They are worth $400.00 of the $500.00 that was decided, which is 80%, so $480.00 of the $600.00 goes to the freelancer and $120.00 goes back to the client. ' +
        'Not met: The page loads in under 3 seconds. ' +
        'The page matches the look of the homepage was never decided, so it is left out.',
    );
  });

  it('explains a split where nothing passed', () => {
    const failed = checks.map((check): SettlementCheck => ({ ...check, outcome: check.outcome === 'undecided' ? 'undecided' : 'failed' }));
    expect(explainSplit(60000, failed, splitOf(failed))).toMatch(
      /^None of the 4 checks that were decided passed, so nothing is paid and the full \$600\.00 goes back to the client\./,
    );
  });

  it('explains a split where nothing was decided', () => {
    const open = checks.map((check): SettlementCheck => ({ ...check, outcome: 'undecided' }));
    expect(explainSplit(60000, open, splitOf(open))).toBe('No check was decided, so nothing is paid and the full $600.00 goes back to the client.');
  });

  it('names several undecided checks together', () => {
    const two: SettlementCheck[] = [...checks.slice(0, 3), { ...checks[3], outcome: 'undecided' }, checks[4]];
    expect(explainSplit(60000, two, splitOf(two))).toContain(
      'No links on the page are broken and The page matches the look of the homepage were never decided, so they are left out.',
    );
  });
});

describe('paidCents', () => {
  it("is the freelancer's share when a split was agreed, even after the payout cleared the release kind", () => {
    expect(paidCents({ amountCents: 60000, splitFreelancerCents: 48000 })).toBe(48000);
    expect(paidCents({ amountCents: 60000, splitFreelancerCents: null })).toBe(60000);
  });
});
