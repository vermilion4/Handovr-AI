import type { ContractStatus, DraftStatus } from './contract';
import type { MilestoneState } from './milestone-state';
import { formatMoney } from './money';

export type Role = 'client' | 'freelancer';

export interface SummaryMilestone {
  position: number;
  title: string;
  amountCents: number;
  state: MilestoneState;
  criteriaDraft: DraftStatus;
  /** What the list of checks needs from the viewer. Treated as ready to sign when absent. */
  contract?: ContractStatus;
}

export interface SummaryInput {
  role: Role;
  /** The other person's full name. */
  counterpartName: string;
  finishedAt: Date | null;
  milestones: SummaryMilestone[];
}

type Tone = 'attention' | 'progress' | 'neutral' | 'done';

export interface ProjectSummary {
  finished: boolean;
  milestoneLabel: string;
  status: { icon: string; text: string; tone: Tone };
  segments: Array<{ amountCents: number; kind: 'released' | 'held' | 'none' }>;
  caption: string;
  actionLabel: string;
  needsViewer: boolean;
}

const ENDED: ReadonlySet<MilestoneState> = new Set(['released', 'cancelled', 'lapsed']);

const HELD: ReadonlySet<MilestoneState> = new Set([
  'funded',
  'verifying',
  'client_review',
  'revision',
  'settlement_proposed',
  'releasing',
  'funding_problem',
]);

const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

function segmentKind(state: MilestoneState): 'released' | 'held' | 'none' {
  if (state === 'released') return 'released';
  return HELD.has(state) ? 'held' : 'none';
}

function countLabel(count: number): string {
  return count === 1 ? '1 milestone' : `${count} milestones`;
}

interface Status {
  icon: string;
  text: string;
  tone: Tone;
  action: string;
}

function currentStatus(milestone: SummaryMilestone, role: Role, other: string): Status {
  const client = role === 'client';
  switch (milestone.state) {
    case 'drafting':
      if (milestone.criteriaDraft === 'failed') {
        return { icon: 'error', text: 'Drafting stopped, open to try again', tone: 'attention', action: 'Open' };
      }
      if (milestone.criteriaDraft !== 'ready') {
        return { icon: 'smart_toy', text: 'Handovr is drafting the criteria', tone: 'progress', action: 'View progress' };
      }
      if (milestone.contract === 'changes_suggested') {
        return { icon: 'rate_review', text: `${other} suggested changes`, tone: 'attention', action: 'Review changes' };
      }
      if (milestone.contract === 'signed_by_viewer') {
        return { icon: 'schedule', text: `You signed. Waiting for ${other} to sign`, tone: 'neutral', action: 'Open' };
      }
      return { icon: 'edit', text: 'Criteria ready for you to sign', tone: 'attention', action: 'Sign criteria' };
    case 'signed':
      return client
        ? { icon: 'lock', text: 'Ready for you to fund', tone: 'attention', action: 'Fund milestone' }
        : { icon: 'schedule', text: `Waiting for ${other} to fund`, tone: 'neutral', action: 'Open' };
    case 'funded':
      return client
        ? { icon: 'schedule', text: `Waiting for ${other} to submit`, tone: 'neutral', action: 'Open' }
        : { icon: 'upload', text: 'Funded and ready for you to submit', tone: 'attention', action: 'Submit work' };
    case 'verifying':
      return { icon: 'progress_activity', text: 'Being tested now', tone: 'progress', action: 'Open' };
    case 'client_review':
      return client
        ? { icon: 'person', text: 'Waiting for your review', tone: 'attention', action: 'Review now' }
        : { icon: 'schedule', text: `Waiting for ${other}'s review`, tone: 'neutral', action: 'Open' };
    case 'revision':
      return client
        ? { icon: 'schedule', text: `${other} is revising the work`, tone: 'neutral', action: 'Open' }
        : { icon: 'cancel', text: 'Needs revision', tone: 'attention', action: 'Open' };
    case 'settlement_proposed':
      return { icon: 'balance', text: 'A split is proposed', tone: 'attention', action: 'Review split' };
    case 'releasing':
      return { icon: 'payments', text: 'Payment is on its way', tone: 'progress', action: 'Open' };
    case 'funding_problem':
      return client
        ? { icon: 'error', text: 'Funding problem, please fund again', tone: 'attention', action: 'Fix funding' }
        : { icon: 'schedule', text: `Waiting for ${other} to fix funding`, tone: 'neutral', action: 'Open' };
    default:
      return { icon: 'check_circle', text: 'Finished', tone: 'done', action: 'Open' };
  }
}

function caption(role: Role, heldCents: number, releasedCents: number, totalCents: number, finished: boolean): string {
  const client = role === 'client';
  const held = `${formatMoney(heldCents)} held${client ? '' : ' for you'}`;
  const released = `${formatMoney(releasedCents)} ${client ? 'released' : 'paid'}`;
  if (finished) return released;
  if (totalCents === 0) return 'Nothing held yet';
  if (heldCents > 0 && releasedCents > 0) return `${held}, ${released} of ${formatMoney(totalCents)}`;
  if (heldCents > 0) return `${held} of ${formatMoney(totalCents)}`;
  if (releasedCents > 0) return `${released} of ${formatMoney(totalCents)}`;
  return `Nothing held yet of ${formatMoney(totalCents)}`;
}

export function summariseProject(input: SummaryInput): ProjectSummary {
  const { role, milestones, finishedAt } = input;
  const other = input.counterpartName.split(' ')[0];

  const segments = milestones.map((m) => ({ amountCents: m.amountCents, kind: segmentKind(m.state) }));
  const sum = (kind: 'released' | 'held') =>
    segments.filter((s) => s.kind === kind).reduce((total, s) => total + s.amountCents, 0);
  const totalCents = milestones.reduce((total, m) => total + m.amountCents, 0);

  if (milestones.length === 0) {
    return {
      finished: false,
      milestoneLabel: 'No milestones yet',
      status: { icon: 'edit', text: 'Add a milestone to get started', tone: 'attention' },
      segments,
      caption: caption(role, 0, 0, 0, false),
      actionLabel: 'Open',
      needsViewer: true,
    };
  }

  const current = milestones.find((m) => !ENDED.has(m.state));

  if (!current) {
    return {
      finished: true,
      milestoneLabel: countLabel(milestones.length),
      status: {
        icon: 'check_circle',
        text: finishedAt ? `Finished ${dayMonth.format(finishedAt)}` : 'Finished',
        tone: 'done',
      },
      segments,
      caption: caption(role, 0, sum('released'), totalCents, true),
      actionLabel: 'Open',
      needsViewer: false,
    };
  }

  const status = currentStatus(current, role, other);
  const draftingAll = current.state === 'drafting' && current.criteriaDraft !== 'ready';

  return {
    finished: false,
    milestoneLabel: draftingAll
      ? countLabel(milestones.length)
      : `Milestone ${current.position} of ${milestones.length}: ${current.title}`,
    status: { icon: status.icon, text: status.text, tone: status.tone },
    segments,
    caption: caption(role, sum('held'), sum('released'), totalCents, false),
    actionLabel: status.action,
    needsViewer: status.tone === 'attention',
  };
}
