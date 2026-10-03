import { eq } from 'drizzle-orm';
import { milestones, projects, submissions, type Db } from '../db/schema';
import { checkUrl } from '../domain/verification';
import { applyEvent } from '../payments/milestone-events';

/** Thrown inside the transaction to undo it and report the reason. */
class Refusal extends Error {}

export async function submitWork(
  db: Db,
  input: { milestoneId: string; userId: string; url: string; repoUrl: string; now: Date },
): Promise<{ ok: true; submissionId: string } | { ok: false; reason: string }> {
  const checked = checkUrl(input.url);
  if (!checked.ok) return checked;

  const repoText = input.repoUrl.trim();
  if (repoText && !/^https:\/\/\S+$/.test(repoText)) {
    return { ok: false, reason: 'The repository link must start with https://.' };
  }

  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ milestone: milestones, project: projects })
        .from(milestones)
        .innerJoin(projects, eq(projects.id, milestones.projectId))
        .where(eq(milestones.id, input.milestoneId))
        .limit(1)
        .for('update', { of: milestones });
      if (!row || row.project.freelancerId !== input.userId) {
        throw new Refusal('Only the freelancer on this project can submit work.');
      }
      if (row.milestone.state !== 'funded' && row.milestone.state !== 'revision') {
        throw new Refusal('This milestone is not waiting for work.');
      }

      const [submission] = await tx
        .insert(submissions)
        .values({
          milestoneId: input.milestoneId,
          attempt: row.milestone.attemptsUsed + 1,
          url: checked.url,
          repoUrl: repoText || null,
          createdAt: input.now,
        })
        .returning({ id: submissions.id });

      const applied = await applyEvent(tx, input.milestoneId, { type: 'work_submitted' }, { now: input.now });
      if (!applied.ok) throw new Refusal(applied.reason);
      return { ok: true as const, submissionId: submission.id };
    });
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, reason: error.message };
    throw error;
  }
}
