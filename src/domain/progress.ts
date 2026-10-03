import type { MilestoneState } from './milestone-state';

export const PROGRESS_STEPS = ['Agreed', 'Held', 'Checked', 'Paid'] as const;

export interface Progress {
  /** How many of the four steps are complete. */
  done: number;
  /** Colours the completed steps: navy before funding, gold while held, blue once paid. */
  tone: 'agreed' | 'held' | 'paid' | 'problem' | 'ended';
  /** One word for the step reached. */
  short: string;
  label: string;
}

const PROGRESS: Record<MilestoneState, Progress> = {
  drafting: { done: 0, tone: 'agreed', short: 'Agreeing', label: 'checks not yet agreed' },
  signed: { done: 1, tone: 'agreed', short: 'Agreed', label: 'agreed, not yet funded' },
  funded: { done: 2, tone: 'held', short: 'Held', label: 'held, work under way' },
  verifying: { done: 2, tone: 'held', short: 'Held', label: 'held, being tested' },
  revision: { done: 2, tone: 'held', short: 'Held', label: 'held, being revised' },
  client_review: { done: 3, tone: 'held', short: 'Checked', label: 'held and tested, waiting for review' },
  settlement_proposed: { done: 3, tone: 'held', short: 'Checked', label: 'held, split proposed' },
  releasing: { done: 3, tone: 'held', short: 'Checked', label: 'payment on its way' },
  released: { done: 4, tone: 'paid', short: 'Paid', label: 'paid' },
  funding_problem: { done: 1, tone: 'problem', short: 'Unfunded', label: 'agreed, funding needs fixing' },
  cancelled: { done: 0, tone: 'ended', short: 'Cancelled', label: 'cancelled, money returned' },
  lapsed: { done: 0, tone: 'ended', short: 'Expired', label: 'hold expired' },
};

export function milestoneProgress(state: MilestoneState): Progress {
  return PROGRESS[state];
}
