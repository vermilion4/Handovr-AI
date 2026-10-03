import { describe, expect, it } from 'vitest';
import { MILESTONE_STATES } from './milestone-state';
import { PROGRESS_STEPS, milestoneProgress } from './progress';

describe('milestoneProgress', () => {
  it('has four steps: agreed, held, checked, paid', () => {
    expect(PROGRESS_STEPS).toEqual(['Agreed', 'Held', 'Checked', 'Paid']);
  });

  it('fills one more step as the milestone moves along', () => {
    const steps = (state: (typeof MILESTONE_STATES)[number]) => [milestoneProgress(state).done, milestoneProgress(state).tone];
    expect(steps('drafting')).toEqual([0, 'agreed']);
    expect(steps('signed')).toEqual([1, 'agreed']);
    expect(steps('funded')).toEqual([2, 'held']);
    expect(steps('verifying')).toEqual([2, 'held']);
    expect(steps('revision')).toEqual([2, 'held']);
    expect(steps('client_review')).toEqual([3, 'held']);
    expect(steps('settlement_proposed')).toEqual([3, 'held']);
    expect(steps('releasing')).toEqual([3, 'held']);
    expect(steps('released')).toEqual([4, 'paid']);
  });

  it('shows a funding problem and an ended milestone apart from normal progress', () => {
    expect(milestoneProgress('funding_problem')).toMatchObject({ done: 1, tone: 'problem' });
    expect(milestoneProgress('cancelled')).toMatchObject({ done: 0, tone: 'ended' });
    expect(milestoneProgress('lapsed')).toMatchObject({ done: 0, tone: 'ended' });
  });

  it('describes every state in words for screen readers', () => {
    for (const state of MILESTONE_STATES) expect(milestoneProgress(state).label).not.toBe('');
    expect(milestoneProgress('client_review').label).toBe('held and tested, waiting for review');
  });

  it('names the step a milestone has reached in one word, for blocks too narrow for all four labels', () => {
    const short = (state: (typeof MILESTONE_STATES)[number]) => milestoneProgress(state).short;
    expect(['drafting', 'signed', 'funded', 'client_review', 'released'].map((state) => short(state as never))).toEqual([
      'Agreeing',
      'Agreed',
      'Held',
      'Checked',
      'Paid',
    ]);
    expect([short('funding_problem'), short('cancelled'), short('lapsed')]).toEqual(['Unfunded', 'Cancelled', 'Expired']);
  });
});
