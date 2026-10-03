'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { claudeModel } from '@/ai/claude';
import { getCurrentUser } from '@/auth/current-user';
import { rewriteCriteria } from '@/criteria/drafter';
import { db } from '@/db/client';
import { getContract, saveEdit } from '@/db/queries/contract';
import { readCriteriaList, type CriterionFields } from '@/domain/criteria';
import { isUuid } from '@/domain/ids';

const UNREADABLE = 'The list could not be read. Reload the page and try again.';

const uuid = (value: unknown): value is string => typeof value === 'string' && isUuid(value);

export async function rewriteAction(
  projectId: string,
  milestoneId: string,
  items: CriterionFields[],
  request: string,
): Promise<{ items?: CriterionFields[]; error?: string }> {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  const contract = uuid(projectId) ? await getContract(db, projectId, user.id) : null;
  const milestone = contract?.milestones.find((candidate) => candidate.id === milestoneId);
  if (!contract || !milestone) return { error: 'That milestone does not exist.' };
  if (milestone.state !== 'drafting') return { error: 'These checks are signed and can no longer be changed.' };

  const current = readCriteriaList(items);
  if (!current || current.length === 0) return { error: UNREADABLE };

  const wanted = typeof request === 'string' ? request.trim() : '';
  if (wanted.length < 5) return { error: 'Describe the change you want.' };
  if (wanted.length > 1000) return { error: 'Keep the request under 1,000 characters.' };

  try {
    const rewritten = await rewriteCriteria(claudeModel(), {
      projectTitle: contract.project.title,
      title: milestone.title,
      brief: milestone.brief,
      amountCents: milestone.amountCents,
      current,
      request: wanted,
    });
    return { items: rewritten };
  } catch (error) {
    console.error('Rewrite failed', error);
    return { error: 'Handovr could not rewrite the list. Try again, or change the checks yourself.' };
  }
}

export async function saveEditAction(
  projectId: string,
  milestoneId: string,
  baseVersionId: string,
  items: CriterionFields[],
  reason: string,
): Promise<{ error: string }> {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');
  if (!uuid(projectId) || !uuid(milestoneId) || !uuid(baseVersionId)) return { error: UNREADABLE };

  const list = readCriteriaList(items);
  if (!list) return { error: UNREADABLE };

  const result = await saveEdit(db, {
    milestoneId,
    authorId: user.id,
    baseVersionId,
    items: list,
    reason: typeof reason === 'string' ? reason.slice(0, 500) : '',
  });
  if (!result.ok) return { error: result.reason };

  revalidatePath(`/projects/${projectId}/criteria`);
  redirect(`/projects/${projectId}/criteria?saved=${milestoneId}`);
}
