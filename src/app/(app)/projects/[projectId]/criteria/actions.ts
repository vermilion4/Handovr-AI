'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { claudeModel } from '@/ai/claude';
import { getCurrentUser } from '@/auth/current-user';
import { draftProject } from '@/criteria/draft-job';
import { db } from '@/db/client';
import {
  acknowledgeVersion,
  declineVersion,
  getContract,
  requeueDrafts,
  signMilestones,
} from '@/db/queries/contract';
import { isUuid } from '@/domain/ids';
import { liveNotice, notifyLater } from '@/notifications/live';
import { takeAllowance } from '@/db/queries/usage';
import { limitsFrom } from '@/domain/usage';

type ActionResult = { error?: string };

async function viewer() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');
  return user;
}

const uuid = (value: unknown): value is string => typeof value === 'string' && isUuid(value);
const liveReady = (milestoneId: string) => liveNotice(db)('lists_ready', milestoneId);

export async function retryDraftingAction(projectId: string): Promise<ActionResult> {
  const user = await viewer();
  if (!uuid(projectId) || !(await getContract(db, projectId, user.id))) {
    return { error: 'That project does not exist.' };
  }
  const allowed = await takeAllowance(db, { userId: user.id, kind: 'draft', now: new Date(), limits: limitsFrom(process.env) });
  if (!allowed.ok) return { error: allowed.message };
  await requeueDrafts(db, projectId, new Date());
  after(() => draftProject(db, claudeModel(), projectId, undefined, liveReady));
  revalidatePath(`/projects/${projectId}/criteria`);
  return {};
}

export async function acceptChangesAction(projectId: string, versionId: string): Promise<ActionResult> {
  const user = await viewer();
  if (!uuid(projectId) || !uuid(versionId)) return { error: 'That list does not exist.' };

  const result = await acknowledgeVersion(db, { versionId, userId: user.id, now: new Date() });
  if (!result.ok) return { error: result.reason };
  revalidatePath(`/projects/${projectId}/criteria`);
  return {};
}

export async function declineChangesAction(projectId: string, versionId: string): Promise<ActionResult> {
  const user = await viewer();
  if (!uuid(projectId) || !uuid(versionId)) return { error: 'That list does not exist.' };

  const result = await declineVersion(db, { versionId, userId: user.id });
  if (!result.ok) return { error: result.reason };
  revalidatePath(`/projects/${projectId}/criteria`);
  return {};
}

export async function signAction(
  projectId: string,
  versionIds: string[],
  typedName: string,
  agreed: boolean,
): Promise<ActionResult & { signed?: number; completed?: number }> {
  const user = await viewer();
  if (!uuid(projectId) || !Array.isArray(versionIds) || !versionIds.every(uuid)) {
    return { error: 'Those milestones could not be read. Reload the page and try again.' };
  }

  const result = await signMilestones(db, {
    projectId,
    userId: user.id,
    versionIds,
    typedName: typeof typedName === 'string' ? typedName : '',
    agreed: agreed === true,
    now: new Date(),
  });
  if (!result.ok) return { error: result.reason };
  for (const milestoneId of result.completedIds) notifyLater(db, { kind: 'signed', milestoneId, to: 'both' });
  revalidatePath(`/projects/${projectId}/criteria`);
  return { signed: result.signed, completed: result.completed };
}
