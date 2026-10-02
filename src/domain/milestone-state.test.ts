import { describe, expect, it } from 'vitest';
import {
  MAX_ATTEMPTS,
  initialContext,
  isFinal,
  transition,
  type MilestoneContext,
  type MilestoneEventType,
} from './milestone-state';

/** Applies events in order and fails the test if any is refused. */
function run(start: MilestoneContext, events: MilestoneEventType[]): MilestoneContext {
  let context = start;
  for (const type of events) {
    const result = transition(context, { type });
    if (!result.ok) throw new Error(result.reason);
    context = result.context;
  }
  return context;
}

const funded = () => run(initialContext(), ['criteria_signed', 'hold_confirmed']);

describe('transition: the path where the work passes', () => {
  it('starts in drafting with no attempts used', () => {
    expect(initialContext()).toEqual({
      state: 'drafting',
      attemptsUsed: 0,
      submittedFrom: null,
      releaseKind: null,
      returnTo: null,
    });
  });

  it('goes from drafting to released', () => {
    const context = run(initialContext(), [
      'criteria_signed',
      'hold_confirmed',
      'work_submitted',
      'verification_passed',
      'client_approved',
      'payout_confirmed',
    ]);
    expect(context.state).toBe('released');
    expect(context.attemptsUsed).toBe(1);
  });

  it('asks for a full capture and payout when the client approves', () => {
    const inReview = run(funded(), ['work_submitted', 'verification_passed']);
    const result = transition(inReview, { type: 'client_approved' });
    expect(result).toMatchObject({
      ok: true,
      context: { state: 'releasing', releaseKind: 'full' },
      effects: [{ type: 'capture_and_payout' }],
    });
  });

  it('releases in full when the client review window runs out', () => {
    const inReview = run(funded(), ['work_submitted', 'verification_passed']);
    const result = transition(inReview, { type: 'review_timed_out' });
    expect(result).toMatchObject({ ok: true, effects: [{ type: 'capture_and_payout' }] });
  });
});

describe('transition: revision and attempts', () => {
  it('sends a failed run to revision and counts the attempt', () => {
    const context = run(funded(), ['work_submitted', 'verification_failed']);
    expect(context).toMatchObject({ state: 'revision', attemptsUsed: 1 });
  });

  it('sends a client rejection to revision', () => {
    const context = run(funded(), ['work_submitted', 'verification_passed', 'client_rejected']);
    expect(context).toMatchObject({ state: 'revision', attemptsUsed: 1 });
  });

  it('does not count a run that stopped because the site was unreachable', () => {
    const first = run(funded(), ['work_submitted', 'site_unreachable']);
    expect(first).toMatchObject({ state: 'funded', attemptsUsed: 0 });

    const later = run(funded(), [
      'work_submitted',
      'verification_failed',
      'work_submitted',
      'site_unreachable',
    ]);
    expect(later).toMatchObject({ state: 'revision', attemptsUsed: 1 });
  });

  it('proposes a settlement when the last allowed run fails', () => {
    const events: MilestoneEventType[] = [];
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) events.push('work_submitted', 'verification_failed');
    const context = run(funded(), events);
    expect(context).toMatchObject({ state: 'settlement_proposed', attemptsUsed: MAX_ATTEMPTS });
  });

  it('proposes a settlement when the client rejects the last allowed run', () => {
    const events: MilestoneEventType[] = [];
    for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) events.push('work_submitted', 'verification_failed');
    events.push('work_submitted', 'verification_passed', 'client_rejected');
    expect(run(funded(), events).state).toBe('settlement_proposed');
  });
});

describe('transition: settlement', () => {
  const proposed = () => {
    const events: MilestoneEventType[] = [];
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) events.push('work_submitted', 'verification_failed');
    return run(funded(), events);
  };

  it('asks for a split capture when both sides accept', () => {
    const result = transition(proposed(), { type: 'settlement_accepted' });
    expect(result).toMatchObject({
      ok: true,
      context: { state: 'releasing', releaseKind: 'split' },
      effects: [{ type: 'capture_split_and_payout' }],
    });
  });

  it.each(['settlement_declined', 'settlement_timed_out'] as const)(
    'voids the hold on %s',
    (type) => {
      const result = transition(proposed(), { type });
      expect(result).toMatchObject({
        ok: true,
        context: { state: 'cancelled' },
        effects: [{ type: 'void_hold' }],
      });
    },
  );
});

describe('transition: funding problems and expiry', () => {
  const releasing = () =>
    run(funded(), ['work_submitted', 'verification_passed', 'client_approved']);

  it('moves to funding_problem when the capture fails', () => {
    expect(run(releasing(), ['capture_failed']).state).toBe('funding_problem');
  });

  it('retries the same kind of release once the client funds again', () => {
    const problem = run(releasing(), ['capture_failed']);
    const result = transition(problem, { type: 'hold_confirmed' });
    expect(result).toMatchObject({
      ok: true,
      context: { state: 'releasing', releaseKind: 'full' },
      effects: [{ type: 'capture_and_payout' }],
    });
  });

  it.each(['funded', 'revision', 'client_review', 'funding_problem'] as const)(
    'lapses from %s when the hold expires',
    (state) => {
      const context: MilestoneContext = { ...funded(), state };
      expect(run(context, ['hold_expired']).state).toBe('lapsed');
    },
  );
});

describe('transition: events that do not belong', () => {
  it('refuses a payout confirmation while drafting and leaves the context alone', () => {
    const start = initialContext();
    const result = transition(start, { type: 'payout_confirmed' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('payout_confirmed');
    expect(start).toEqual(initialContext());
  });

  it('refuses hold expiry before any hold exists', () => {
    expect(transition(initialContext(), { type: 'hold_expired' }).ok).toBe(false);
  });

  it('refuses a client approval before the work was verified', () => {
    expect(transition(funded(), { type: 'client_approved' }).ok).toBe(false);
  });

  it.each(['released', 'cancelled', 'lapsed'] as const)(
    'refuses every event once the milestone is %s',
    (state) => {
      const context: MilestoneContext = { ...funded(), state };
      const all: MilestoneEventType[] = [
        'criteria_signed', 'hold_confirmed', 'work_submitted', 'site_unreachable',
        'verification_passed', 'verification_failed', 'client_approved', 'review_timed_out',
        'client_rejected', 'settlement_accepted', 'settlement_declined', 'settlement_timed_out',
        'payout_confirmed', 'capture_failed', 'hold_expired', 'hold_invalid',
      ];
      for (const type of all) expect(transition(context, { type }).ok).toBe(false);
      expect(isFinal(state)).toBe(true);
    },
  );
});

describe('transition: a hold that becomes invalid', () => {
  it.each(['funded', 'verifying', 'client_review', 'revision', 'settlement_proposed'] as const)(
    'moves %s to funding_problem and remembers where it was',
    (state) => {
      const context: MilestoneContext = { ...funded(), state };
      const result = transition(context, { type: 'hold_invalid' });
      expect(result).toMatchObject({
        ok: true,
        context: { state: 'funding_problem', returnTo: state },
        effects: [],
      });
    },
  );

  it('returns to the state it came from once the client funds again, without moving money', () => {
    const revising: MilestoneContext = { ...funded(), state: 'revision', attemptsUsed: 1 };
    const problem = run(revising, ['hold_invalid']);
    const result = transition(problem, { type: 'hold_confirmed' });
    expect(result).toMatchObject({
      ok: true,
      context: { state: 'revision', returnTo: null, attemptsUsed: 1 },
      effects: [],
    });
  });

  it.each(['drafting', 'signed', 'releasing'] as const)('refuses hold_invalid in %s', (state) => {
    const context: MilestoneContext = { ...funded(), state };
    expect(transition(context, { type: 'hold_invalid' }).ok).toBe(false);
  });

  it('refuses re-funding when it does not know which state to return to', () => {
    const context: MilestoneContext = { ...funded(), state: 'funding_problem', returnTo: null };
    expect(transition(context, { type: 'hold_confirmed' }).ok).toBe(false);
  });
});
