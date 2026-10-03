import { randomUUID } from 'node:crypto';
import { eq, max } from 'drizzle-orm';
import { criteriaOf, insertVersion, latestVersion } from '../db/queries/contract';
import { milestones, projects, type Db } from '../db/schema';

/** Thrown inside the transaction to undo it and report the reason. */
class Refusal extends Error {}

/** Adds a copy of a cancelled or lapsed milestone at the end of the project, for both people to sign again. */
export async function restartMilestone(
  db: Db,
  input: { milestoneId: string; userId: string; now: Date },
): Promise<{ ok: true; milestoneId: string } | { ok: false; reason: string }> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ milestone: milestones, project: projects })
        .from(milestones)
        .innerJoin(projects, eq(projects.id, milestones.projectId))
        .where(eq(milestones.id, input.milestoneId))
        .limit(1)
        .for('update', { of: milestones });
      if (!row || row.project.clientId !== input.userId) throw new Refusal('Only the client can start a milestone again.');
      if (row.milestone.state !== 'cancelled' && row.milestone.state !== 'lapsed') {
        throw new Refusal('Only a cancelled milestone or one whose hold expired can be started again.');
      }
      const [already] = await tx.select({ id: milestones.id }).from(milestones).where(eq(milestones.restartedFromId, row.milestone.id)).limit(1);
      if (already) throw new Refusal('This milestone has already been started again.');

      const [{ last }] = await tx.select({ last: max(milestones.position) }).from(milestones).where(eq(milestones.projectId, row.project.id));
      const [copy] = await tx
        .insert(milestones)
        .values({
          projectId: row.project.id,
          position: (last ?? 0) + 1,
          title: row.milestone.title,
          brief: row.milestone.brief,
          amountCents: row.milestone.amountCents,
          criteriaDraft: 'ready',
          restartedFromId: row.milestone.id,
        })
        .returning({ id: milestones.id });

      const signed = await latestVersion(tx, row.milestone.id);
      const checks = signed ? await criteriaOf(tx, signed.id) : [];
      await insertVersion(
        tx,
        { milestoneId: copy.id, number: 1, authorId: null, reason: '' },
        checks.map((check) => ({ ...check, key: randomUUID() })),
      );
      await tx.update(projects).set({ finishedAt: null }).where(eq(projects.id, row.project.id));
      return { ok: true as const, milestoneId: copy.id };
    });
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, reason: error.message };
    throw error;
  }
}
