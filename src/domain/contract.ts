import type { MilestoneState } from './milestone-state';

export type DraftStatus = 'pending' | 'drafting' | 'ready' | 'failed';

export const DRAFT_STALE_MS = 3 * 60 * 1000;

export function draftingActive(
  milestones: Array<{ criteriaDraft: DraftStatus; criteriaDraftStartedAt: Date | null }>,
  now: Date,
): boolean {
  return milestones.some(
    (milestone) =>
      (milestone.criteriaDraft === 'pending' || milestone.criteriaDraft === 'drafting') &&
      milestone.criteriaDraftStartedAt !== null &&
      now.getTime() - milestone.criteriaDraftStartedAt.getTime() < DRAFT_STALE_MS,
  );
}

export interface VersionSummary {
  /** Null when Handovr drafted the list. */
  authorId: string | null;
  acknowledged: boolean;
  signedBy: string[];
}

export function needsAcknowledgement(version: VersionSummary, viewerId: string): boolean {
  return version.authorId !== null && version.authorId !== viewerId && !version.acknowledged;
}

export type ContractStatus =
  | 'drafting'
  | 'draft_failed'
  | 'changes_suggested'
  | 'ready_to_sign'
  | 'signed_by_viewer'
  | 'signed';

export function contractStatus(
  milestone: { state: MilestoneState; criteriaDraft: DraftStatus; version: VersionSummary | null },
  viewerId: string,
): ContractStatus {
  if (milestone.state !== 'drafting') return 'signed';
  if (milestone.criteriaDraft === 'failed') return 'draft_failed';
  if (milestone.criteriaDraft !== 'ready' || !milestone.version) return 'drafting';
  if (needsAcknowledgement(milestone.version, viewerId)) return 'changes_suggested';
  return milestone.version.signedBy.includes(viewerId) ? 'signed_by_viewer' : 'ready_to_sign';
}

function plainName(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function namesMatch(typed: string, accountName: string): boolean {
  const plain = plainName(typed);
  return plain !== '' && plain === plainName(accountName);
}
