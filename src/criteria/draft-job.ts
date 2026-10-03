import { asc, eq } from 'drizzle-orm';
import { claimDraft, failDraft, listPendingDrafts, saveDraft } from '../db/queries/contract';
import { milestones, type Db } from '../db/schema';
import { draftCriteria, type StructuredModel } from './drafter';

export async function draftProject(
  db: Db,
  model: StructuredModel,
  projectId: string,
  now: () => Date = () => new Date(),
  onReady?: (firstMilestoneId: string) => Promise<void>,
): Promise<void> {
  const pending = await listPendingDrafts(db, projectId);
  let saved = 0;
  await Promise.all(
    pending.map(async (milestoneId) => {
      const job = await claimDraft(db, milestoneId, now());
      if (!job) return;
      try {
        await saveDraft(db, milestoneId, await draftCriteria(model, job));
        saved += 1;
      } catch (error) {
        console.error(`Drafting failed for milestone ${milestoneId}`, error);
        await failDraft(db, milestoneId);
      }
    }),
  );

  if (!onReady || saved === 0) return;
  const rows = await db
    .select({ id: milestones.id, draft: milestones.criteriaDraft })
    .from(milestones)
    .where(eq(milestones.projectId, projectId))
    .orderBy(asc(milestones.position));
  if (rows.every((row) => row.draft === 'ready')) await onReady(rows[0].id);
}
