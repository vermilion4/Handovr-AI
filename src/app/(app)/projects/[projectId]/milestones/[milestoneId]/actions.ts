'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { getCurrentUser } from '@/auth/current-user';
import { db } from '@/db/client';
import { isUuid } from '@/domain/ids';
import type { ClientDecision } from '@/domain/verification';
import { liveGateway } from '@/payments/live';
import { processPayments } from '@/payments/processor';
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
): Promise<{ error?: string; released?: boolean }> {
  const user = await viewer();
  if (!uuid(projectId) || !uuid(milestoneId)) return { error: 'That milestone does not exist.' };

  const clean: Record<string, ClientDecision> = {};
  for (const [id, decision] of Object.entries(decisions ?? {})) {
    if (uuid(id) && (decision === 'approved' || decision === 'rejected')) clean[id] = decision;
  }

  const result = await submitReview(db, { milestoneId, userId: user.id, decisions: clean, reason: text(reason), now: new Date() });
  if (!result.ok) return { error: result.reason };
  if (result.released) after(() => processPayments(db, liveGateway(), new Date()));
  // The page refreshes when the person closes the result dialog, so it is not revalidated here.
  return { released: result.released };
}
