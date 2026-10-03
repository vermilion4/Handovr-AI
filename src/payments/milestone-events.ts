import { and, desc, eq } from 'drizzle-orm';
import { holds, milestones, paymentEvents, projects, type Db } from '../db/schema';
import { holdTotalCents } from '../domain/hold';
import { isFinal, transition, type MilestoneEvent, type MilestoneState } from '../domain/milestone-state';

export type ApplyResult = { ok: true; state: MilestoneState } | { ok: false; reason: string };

/** Runs one state machine event on a milestone and queues any money work it calls for. */
export async function applyEvent(
  db: Db,
  milestoneId: string,
  event: MilestoneEvent,
  options: { now: Date; splitFreelancerCents?: number },
): Promise<ApplyResult> {
  return db.transaction(async (tx): Promise<ApplyResult> => {
    const [milestone] = await tx.select().from(milestones).where(eq(milestones.id, milestoneId)).limit(1).for('update');
    if (!milestone) return { ok: false, reason: 'That milestone does not exist.' };

    const result = transition(
      {
        state: milestone.state,
        attemptsUsed: milestone.attemptsUsed,
        submittedFrom: milestone.submittedFrom,
        releaseKind: milestone.releaseKind,
        returnTo: milestone.returnTo,
      },
      event,
    );
    if (!result.ok) return result;

    const splitCents = options.splitFreelancerCents ?? milestone.splitFreelancerCents;

    for (const effect of result.effects) {
      const [hold] = await tx
        .select()
        .from(holds)
        .where(and(eq(holds.milestoneId, milestoneId), eq(holds.status, 'active')))
        .orderBy(desc(holds.createdAt))
        .limit(1);
      if (!hold) return { ok: false, reason: 'There is no active hold for this milestone.' };

      const row = { milestoneId, holdId: hold.id, createdAt: options.now, updatedAt: options.now };
      if (effect.type === 'void_hold') {
        await tx.insert(paymentEvents).values({ ...row, type: 'void', status: 'pending', amountCents: hold.totalCents });
        continue;
      }

      const full = effect.type === 'capture_and_payout';
      const payoutCents = full ? milestone.amountCents : splitCents;
      if (!payoutCents || payoutCents <= 0 || payoutCents > milestone.amountCents) {
        return { ok: false, reason: 'The split must be between one cent and the milestone amount.' };
      }
      await tx.insert(paymentEvents).values([
        { ...row, type: 'capture', status: 'pending', amountCents: full ? hold.totalCents : holdTotalCents(payoutCents) },
        // A moment later, so the two rows keep their order when listed by time.
        { ...row, type: 'payout', status: 'blocked', amountCents: payoutCents, createdAt: new Date(options.now.getTime() + 1) },
      ]);
    }

    const next = result.context;
    await tx
      .update(milestones)
      .set({
        state: next.state,
        attemptsUsed: next.attemptsUsed,
        submittedFrom: next.submittedFrom,
        releaseKind: next.releaseKind,
        returnTo: next.returnTo,
        splitFreelancerCents: splitCents ?? null,
      })
      .where(eq(milestones.id, milestoneId));

    if (isFinal(next.state)) {
      const siblings = await tx
        .select({ state: milestones.state })
        .from(milestones)
        .where(eq(milestones.projectId, milestone.projectId));
      if (siblings.every((sibling) => isFinal(sibling.state))) {
        await tx.update(projects).set({ finishedAt: options.now }).where(eq(projects.id, milestone.projectId));
      }
    }

    return { ok: true, state: next.state };
  });
}
