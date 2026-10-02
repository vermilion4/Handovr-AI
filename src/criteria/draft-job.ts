import { claimDraft, failDraft, listPendingDrafts, saveDraft } from '../db/queries/contract';
import type { Db } from '../db/schema';
import { draftCriteria, type StructuredModel } from './drafter';

export async function draftProject(
  db: Db,
  model: StructuredModel,
  projectId: string,
  now: () => Date = () => new Date(),
): Promise<void> {
  const pending = await listPendingDrafts(db, projectId);
  await Promise.all(
    pending.map(async (milestoneId) => {
      const job = await claimDraft(db, milestoneId, now());
      if (!job) return;
      try {
        await saveDraft(db, milestoneId, await draftCriteria(model, job));
      } catch (error) {
        console.error(`Drafting failed for milestone ${milestoneId}`, error);
        await failDraft(db, milestoneId);
      }
    }),
  );
}
