import { and, desc, eq, lte } from 'drizzle-orm';
import { milestones, projects, settlements, type Db } from '../db/schema';
import { noNotice, type Notice } from '../notifications/notice';
import { applyEvent } from '../payments/milestone-events';

/** Thrown inside the transaction to undo it and report the reason. */
class Refusal extends Error {}

export async function respondToSettlement(
  db: Db,
  input: { milestoneId: string; userId: string; response: 'accepted' | 'declined'; now: Date },
): Promise<{ ok: true; outcome: 'waiting' | 'accepted' | 'declined' } | { ok: false; reason: string }> {
  try {
    return await db.transaction(async (tx) => {
      // Locking the milestone first makes two answers arriving together run one after the other.
      const [row] = await tx
        .select({ milestone: milestones, project: projects })
        .from(milestones)
        .innerJoin(projects, eq(projects.id, milestones.projectId))
        .where(eq(milestones.id, input.milestoneId))
        .limit(1)
        .for('update', { of: milestones });
      const side = row?.project.clientId === input.userId ? 'client' : row?.project.freelancerId === input.userId ? 'freelancer' : null;
      if (!row || !side) throw new Refusal('Only the client and the freelancer on this project can answer.');

      const [settlement] = await tx
        .select()
        .from(settlements)
        .where(and(eq(settlements.milestoneId, input.milestoneId), eq(settlements.outcome, 'pending')))
        .orderBy(desc(settlements.createdAt))
        .limit(1);
      if (row.milestone.state !== 'settlement_proposed' || !settlement) throw new Refusal('This split has already been decided.');
      if (settlement.dueAt <= input.now) throw new Refusal('The time to answer this split has ended.');
      const mine = side === 'client' ? settlement.clientResponse : settlement.freelancerResponse;
      if (mine) throw new Refusal('You have already answered this split.');

      const responses = {
        clientResponse: side === 'client' ? input.response : settlement.clientResponse,
        freelancerResponse: side === 'freelancer' ? input.response : settlement.freelancerResponse,
      };
      const outcome =
        input.response === 'declined'
          ? 'declined'
          : responses.clientResponse === 'accepted' && responses.freelancerResponse === 'accepted'
            ? 'accepted'
            : 'waiting';

      if (outcome !== 'waiting') {
        const applied = await applyEvent(
          tx,
          input.milestoneId,
          { type: outcome === 'accepted' ? 'settlement_accepted' : 'settlement_declined' },
          { now: input.now, splitFreelancerCents: settlement.freelancerCents },
        );
        if (!applied.ok) throw new Refusal(applied.reason);
      }
      await tx
        .update(settlements)
        .set({ ...responses, outcome: outcome === 'waiting' ? 'pending' : outcome, decidedAt: outcome === 'waiting' ? null : input.now })
        .where(eq(settlements.id, settlement.id));
      return { ok: true as const, outcome };
    });
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, reason: error.message };
    throw error;
  }
}

export async function expireSettlements(db: Db, now: Date, notice: Notice = noNotice): Promise<number> {
  const due = await db
    .select({ id: settlements.id, milestoneId: settlements.milestoneId })
    .from(settlements)
    .where(and(eq(settlements.outcome, 'pending'), lte(settlements.dueAt, now)));

  let expired = 0;
  for (const { id, milestoneId } of due) {
    const done = await db
      .transaction(async (tx) => {
        await tx.select({ id: milestones.id }).from(milestones).where(eq(milestones.id, milestoneId)).for('update');
        const [settlement] = await tx.select().from(settlements).where(eq(settlements.id, id));
        if (settlement.outcome !== 'pending') return false;
        const applied = await applyEvent(tx, milestoneId, { type: 'settlement_timed_out' }, { now });
        if (!applied.ok) throw new Refusal(applied.reason);
        await tx.update(settlements).set({ outcome: 'timed_out', decidedAt: now }).where(eq(settlements.id, id));
        return true;
      })
      .catch((error) => {
        if (!(error instanceof Refusal)) throw error;
        console.error(`The split for milestone ${milestoneId} ran out of time but could not be cancelled: ${error.message}`);
        return false;
      });
    if (done) {
      expired += 1;
      await notice('cancelled', milestoneId);
    }
  }
  return expired;
}
