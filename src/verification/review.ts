import { and, desc, eq, isNotNull, lte } from 'drizzle-orm';
import { milestones, projects, submissions, verdicts, type Db } from '../db/schema';
import { itemsForClient, reviewOutcome, type ClientDecision } from '../domain/verification';
import { applyEvent } from '../payments/milestone-events';
import { proposeSettlement } from '../settlement/propose';
import { checkOutcomes } from './outcomes';

/** Thrown inside the transaction to undo it and report the reason. */
class Refusal extends Error {}

const AUTO_APPROVED = 'Approved automatically when the review window ended.';

async function latestSubmission(db: Db, milestoneId: string) {
  const [row] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.milestoneId, milestoneId))
    .orderBy(desc(submissions.createdAt))
    .limit(1);
  return row ?? null;
}

export async function submitReview(
  db: Db,
  input: { milestoneId: string; userId: string; decisions: Record<string, ClientDecision>; reason: string; now: Date; windowSeconds: number },
): Promise<{ ok: true; released: boolean; settlement: 'proposed' | 'cancelled' | 'skipped' } | { ok: false; reason: string }> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ milestone: milestones, project: projects })
        .from(milestones)
        .innerJoin(projects, eq(projects.id, milestones.projectId))
        .where(eq(milestones.id, input.milestoneId))
        .limit(1)
        .for('update', { of: milestones });
      if (!row || row.project.clientId !== input.userId) throw new Refusal('Only the client on this project can review it.');
      if (row.milestone.state !== 'client_review') throw new Refusal('This milestone is not waiting for your review.');

      const submission = await latestSubmission(tx, input.milestoneId);
      if (!submission) throw new Refusal('This milestone is not waiting for your review.');
      const items = itemsForClient(await checkOutcomes(tx, input.milestoneId, submission.id));

      const outcome = reviewOutcome(items, input.decisions);
      if (outcome === 'incomplete') throw new Refusal('Decide every check marked as yours before sending the review.');
      const reason = input.reason.trim();
      if (outcome === 'rejected' && reason.length < 10) throw new Refusal('Say what needs to change, in a sentence or two.');

      if (items.length > 0) {
        await tx.insert(verdicts).values(
          items.map((criterionId) => ({
            submissionId: submission.id,
            criterionId,
            source: 'client' as const,
            verdict: input.decisions[criterionId],
            summary: input.decisions[criterionId] === 'rejected' ? reason : 'Approved by the client.',
            createdAt: input.now,
          })),
        );
      }

      const applied = await applyEvent(tx, input.milestoneId, { type: outcome === 'approved' ? 'client_approved' : 'client_rejected' }, { now: input.now });
      if (!applied.ok) throw new Refusal(applied.reason);
      await tx.update(milestones).set({ reviewDueAt: null }).where(eq(milestones.id, input.milestoneId));
      const settlement =
        applied.state === 'settlement_proposed'
          ? await proposeSettlement(tx, input.milestoneId, { now: input.now, windowSeconds: input.windowSeconds })
          : ('skipped' as const);
      return { ok: true as const, released: outcome === 'approved', settlement };
    });
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, reason: error.message };
    throw error;
  }
}

export async function expireReviews(db: Db, now: Date): Promise<number> {
  const due = await db
    .select({ id: milestones.id })
    .from(milestones)
    .where(and(eq(milestones.state, 'client_review'), isNotNull(milestones.reviewDueAt), lte(milestones.reviewDueAt, now)));

  let released = 0;
  for (const { id } of due) {
    const done = await db.transaction(async (tx) => {
      const [milestone] = await tx.select().from(milestones).where(eq(milestones.id, id)).limit(1).for('update');
      if (milestone.state !== 'client_review' || !milestone.reviewDueAt || milestone.reviewDueAt > now) return false;

      const submission = await latestSubmission(tx, id);
      if (submission) {
        const items = itemsForClient(await checkOutcomes(tx, id, submission.id));
        if (items.length > 0) {
          await tx
            .insert(verdicts)
            .values(items.map((criterionId) => ({ submissionId: submission.id, criterionId, source: 'client' as const, verdict: 'approved' as const, summary: AUTO_APPROVED, createdAt: now })))
            .onConflictDoNothing();
        }
      }
      const applied = await applyEvent(tx, id, { type: 'review_timed_out' }, { now });
      // Undo the automatic approvals when the release cannot go ahead.
      if (!applied.ok) throw new Refusal(applied.reason);
      await tx.update(milestones).set({ reviewDueAt: null }).where(eq(milestones.id, id));
      return true;
    }).catch((error) => {
      if (!(error instanceof Refusal)) throw error;
      console.error(`The review window of milestone ${id} ended but the release was refused: ${error.message}`);
      return false;
    });
    if (done) released += 1;
  }
  return released;
}
