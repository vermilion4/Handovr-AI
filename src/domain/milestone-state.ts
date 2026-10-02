/** The initial submission plus three resubmissions. */
export const MAX_ATTEMPTS = 4;

export const MILESTONE_STATES = [
  'drafting',
  'signed',
  'funded',
  'verifying',
  'client_review',
  'revision',
  'settlement_proposed',
  'releasing',
  'released',
  'cancelled',
  'funding_problem',
  'lapsed',
] as const;

export type MilestoneState = (typeof MILESTONE_STATES)[number];

export type MilestoneEventType =
  | 'criteria_signed'
  | 'hold_confirmed'
  | 'work_submitted'
  | 'site_unreachable'
  | 'verification_passed'
  | 'verification_failed'
  | 'client_approved'
  | 'review_timed_out'
  | 'client_rejected'
  | 'settlement_accepted'
  | 'settlement_declined'
  | 'settlement_timed_out'
  | 'payout_confirmed'
  | 'capture_failed'
  | 'hold_expired'
  | 'hold_invalid';

export interface MilestoneEvent {
  type: MilestoneEventType;
}

export interface MilestoneContext {
  state: MilestoneState;
  /** Completed verification runs. Unreachable-site runs are not counted. */
  attemptsUsed: number;
  /** The state the current submission was made from. */
  submittedFrom: 'funded' | 'revision' | null;
  /** The kind of release in progress. */
  releaseKind: 'full' | 'split' | null;
  /** The state to return to after a funding problem. */
  returnTo: MilestoneState | null;
}

/** Money movements for the payments layer to carry out. */
export type Effect =
  | { type: 'capture_and_payout' }
  | { type: 'capture_split_and_payout' }
  | { type: 'void_hold' };

export type TransitionResult =
  | { ok: true; context: MilestoneContext; effects: Effect[] }
  | { ok: false; reason: string };

const FINAL_STATES: ReadonlySet<MilestoneState> = new Set(['released', 'cancelled', 'lapsed']);

const HOLD_CAN_EXPIRE: ReadonlySet<MilestoneState> = new Set([
  'funded',
  'verifying',
  'client_review',
  'revision',
  'settlement_proposed',
  'funding_problem',
]);

/** States with a live hold that PayPal can report as no longer valid. */
const HOLD_CAN_BECOME_INVALID: ReadonlySet<MilestoneState> = new Set([
  'funded',
  'verifying',
  'client_review',
  'revision',
  'settlement_proposed',
]);

export function initialContext(): MilestoneContext {
  return { state: 'drafting', attemptsUsed: 0, submittedFrom: null, releaseKind: null, returnTo: null };
}

export function isFinal(state: MilestoneState): boolean {
  return FINAL_STATES.has(state);
}

function releaseEffect(kind: 'full' | 'split'): Effect {
  return kind === 'full' ? { type: 'capture_and_payout' } : { type: 'capture_split_and_payout' };
}

export function transition(context: MilestoneContext, event: MilestoneEvent): TransitionResult {
  const go = (
    state: MilestoneState,
    patch: Partial<MilestoneContext> = {},
    effects: Effect[] = [],
  ): TransitionResult => ({ ok: true, context: { ...context, ...patch, state }, effects });

  const refuse = (): TransitionResult => ({
    ok: false,
    reason: `Event "${event.type}" is not allowed in state "${context.state}"`,
  });

  if (isFinal(context.state)) return refuse();

  if (event.type === 'hold_expired') {
    return HOLD_CAN_EXPIRE.has(context.state) ? go('lapsed') : refuse();
  }

  if (event.type === 'hold_invalid') {
    return HOLD_CAN_BECOME_INVALID.has(context.state)
      ? go('funding_problem', { returnTo: context.state })
      : refuse();
  }

  const afterFailedAttempt = (attemptsUsed: number): TransitionResult =>
    attemptsUsed >= MAX_ATTEMPTS
      ? go('settlement_proposed', { attemptsUsed, submittedFrom: null })
      : go('revision', { attemptsUsed, submittedFrom: null });

  switch (context.state) {
    case 'drafting':
      return event.type === 'criteria_signed' ? go('signed') : refuse();

    case 'signed':
      return event.type === 'hold_confirmed' ? go('funded') : refuse();

    case 'funded':
      return event.type === 'work_submitted' ? go('verifying', { submittedFrom: 'funded' }) : refuse();

    case 'revision':
      return event.type === 'work_submitted' ? go('verifying', { submittedFrom: 'revision' }) : refuse();

    case 'verifying':
      if (event.type === 'site_unreachable') {
        return go(context.submittedFrom ?? 'funded', { submittedFrom: null });
      }
      if (event.type === 'verification_passed') {
        return go('client_review', { attemptsUsed: context.attemptsUsed + 1, submittedFrom: null });
      }
      if (event.type === 'verification_failed') {
        return afterFailedAttempt(context.attemptsUsed + 1);
      }
      return refuse();

    case 'client_review':
      if (event.type === 'client_approved' || event.type === 'review_timed_out') {
        return go('releasing', { releaseKind: 'full' }, [releaseEffect('full')]);
      }
      if (event.type === 'client_rejected') {
        return afterFailedAttempt(context.attemptsUsed);
      }
      return refuse();

    case 'settlement_proposed':
      if (event.type === 'settlement_accepted') {
        return go('releasing', { releaseKind: 'split' }, [releaseEffect('split')]);
      }
      if (event.type === 'settlement_declined' || event.type === 'settlement_timed_out') {
        return go('cancelled', {}, [{ type: 'void_hold' }]);
      }
      return refuse();

    case 'releasing':
      if (event.type === 'payout_confirmed') return go('released', { releaseKind: null });
      if (event.type === 'capture_failed') return go('funding_problem', { returnTo: 'releasing' });
      return refuse();

    case 'funding_problem':
      if (event.type !== 'hold_confirmed' || !context.returnTo) return refuse();
      if (context.returnTo === 'releasing') {
        return context.releaseKind
          ? go('releasing', { returnTo: null }, [releaseEffect(context.releaseKind)])
          : refuse();
      }
      return go(context.returnTo, { returnTo: null });

    default:
      return refuse();
  }
}
