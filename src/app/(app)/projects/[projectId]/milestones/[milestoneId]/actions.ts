'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { claudeModel } from '@/ai/claude';
import { getCurrentUser } from '@/auth/current-user';
import { db } from '@/db/client';
import { takeAllowance } from '@/db/queries/usage';
import { isUuid } from '@/domain/ids';
import { limitsFrom } from '@/domain/usage';
import { reviewWindowSeconds, type ClientDecision } from '@/domain/verification';
import { liveNotice, notifyLater } from '@/notifications/live';
import { liveGateway } from '@/payments/live';
import { processPayments } from '@/payments/processor';
import { improveExplanation } from '@/settlement/propose';
import { respondToSettlement } from '@/settlement/respond';
import { restartMilestone } from '@/settlement/restart';
import { liveVerificationDeps } from '@/verification/live';
import { submitReview } from '@/verification/review';
import { runVerification } from '@/verification/run';
import { submitWork } from '@/verification/submissions';

const uuid = (value: unknown): value is string => typeof value === 'string' && isUuid(value);
const text = (value: unknown) => (typeof value === 'string' ? value : '');

async function viewer() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');
  return user;
}

export async function submitWorkAction(projectId: string, milestoneId: string, url: string, repoUrl: string): Promise<{ error?: string }> {
  const user = await viewer();
  if (!uuid(projectId) || !uuid(milestoneId)) return { error: 'That milestone does not exist.' };

  const allowed = await takeAllowance(db, { userId: user.id, kind: 'verify', now: new Date(), limits: limitsFrom(process.env) });
  if (!allowed.ok) return { error: allowed.message };
  const result = await submitWork(db, { milestoneId, userId: user.id, url: text(url), repoUrl: text(repoUrl), now: new Date() });
  if (!result.ok) return { error: result.reason };

  after(() =>
    runVerification(db, liveVerificationDeps(db), result.submissionId).catch((error) =>
      console.error(`Verification run ${result.submissionId} failed`, error),
    ),
  );
  revalidatePath(`/projects/${projectId}/milestones/${milestoneId}`);
  return {};
}

export async function submitReviewAction(
  projectId: string,
  milestoneId: string,
  decisions: Record<string, ClientDecision>,
  reason: string,
): Promise<{ error?: string; released?: boolean; settlement?: 'proposed' | 'cancelled' | 'skipped' }> {
  const user = await viewer();
  if (!uuid(projectId) || !uuid(milestoneId)) return { error: 'That milestone does not exist.' };

  const clean: Record<string, ClientDecision> = {};
  for (const [id, decision] of Object.entries(decisions ?? {})) {
    if (uuid(id) && (decision === 'approved' || decision === 'rejected')) clean[id] = decision;
  }

  const result = await submitReview(db, {
    milestoneId,
    userId: user.id,
    decisions: clean,
    reason: text(reason),
    now: new Date(),
    windowSeconds: reviewWindowSeconds(process.env.REVIEW_WINDOW_SECONDS),
  });
  if (!result.ok) return { error: result.reason };
  if (result.released || result.settlement === 'cancelled') after(() => processPayments(db, liveGateway(), new Date(), liveNotice(db)));
  if (result.settlement === 'proposed') after(() => improveExplanation(db, claudeModel(), milestoneId));
  if (!result.released) {
    const kind = result.settlement === 'proposed' ? 'split_proposed' : result.settlement === 'cancelled' ? 'cancelled' : 'sent_back';
    notifyLater(db, { kind, milestoneId, to: 'both' });
  }
  // The page refreshes when the person closes the result dialog, so it is not revalidated here.
  return { released: result.released, settlement: result.settlement };
}

export async function respondToSettlementAction(
  projectId: string,
  milestoneId: string,
  response: 'accepted' | 'declined',
): Promise<{ error?: string; outcome?: 'waiting' | 'accepted' | 'declined' }> {
  const user = await viewer();
  if (!uuid(projectId) || !uuid(milestoneId) || (response !== 'accepted' && response !== 'declined')) {
    return { error: 'That milestone does not exist.' };
  }
  const result = await respondToSettlement(db, { milestoneId, userId: user.id, response, now: new Date() });
  if (!result.ok) return { error: result.reason };
  if (result.outcome !== 'waiting') after(() => processPayments(db, liveGateway(), new Date(), liveNotice(db)));
  if (result.outcome === 'declined') notifyLater(db, { kind: 'cancelled', milestoneId, to: 'both' });
  return { outcome: result.outcome };
}

export async function restartMilestoneAction(projectId: string, milestoneId: string): Promise<{ error?: string }> {
  const user = await viewer();
  if (!uuid(projectId) || !uuid(milestoneId)) return { error: 'That milestone does not exist.' };
  const result = await restartMilestone(db, { milestoneId, userId: user.id, now: new Date() });
  if (!result.ok) return { error: result.reason };
  redirect(`/projects/${projectId}/criteria`);
}
