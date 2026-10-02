import { describe, expect, it } from 'vitest';
import { proposeSplit, type CriterionOutcome } from './settlement';

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
