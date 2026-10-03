import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import { milestones, submissions, type Db } from '../db/schema';

const QUIET_RUN_MS = 20 * 60 * 1000;
const START_GRACE_MS = 60 * 1000;

export async function verificationsToRun(db: Db, now: Date): Promise<string[]> {
  await db
    .update(submissions)
    .set({ status: 'queued', currentCriterionId: null, progressNote: 'The test run stopped and will start again.' })
    .where(
      and(
        eq(submissions.status, 'running'),
        eq(submissions.simulated, false),
        lt(sql`coalesce(${submissions.heartbeatAt}, ${submissions.startedAt})`, new Date(now.getTime() - QUIET_RUN_MS)),
      ),
    );

  const rows = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(
      and(
        eq(submissions.status, 'queued'),
        eq(submissions.simulated, false),
        lt(submissions.createdAt, new Date(now.getTime() - START_GRACE_MS)),
        inArray(submissions.milestoneId, db.select({ id: milestones.id }).from(milestones).where(eq(milestones.state, 'verifying'))),
      ),
    )
    .orderBy(asc(submissions.createdAt));
  return rows.map((row) => row.id);
}
