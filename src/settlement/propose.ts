import { and, desc, eq, ne } from 'drizzle-orm';
import type { StructuredModel } from '../criteria/drafter';
import { milestones, settlements, submissions, verdicts, type Db } from '../db/schema';
import { explainSplit, finalOutcome, proposeSplit, type SettlementCheck } from '../domain/settlement';
import type { AiVerdict, ClientDecision } from '../domain/verification';
import { applyEvent } from '../payments/milestone-events';
import { signedChecks } from '../verification/outcomes';
import { explainSettlement } from './explainer';

/** Each signed check with its final outcome on the last submission that was actually tested. */
export async function settlementChecks(
  db: Db,
  milestoneId: string,
): Promise<{ amountCents: number; submissionId: string | null; checks: Array<SettlementCheck & { summary: string }> }> {
  const [milestone] = await db.select({ amountCents: milestones.amountCents }).from(milestones).where(eq(milestones.id, milestoneId));
  const [tested] = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(and(eq(submissions.milestoneId, milestoneId), ne(submissions.status, 'unreachable')))
    .orderBy(desc(submissions.createdAt))
    .limit(1);
  const rows = tested ? await db.select().from(verdicts).where(eq(verdicts.submissionId, tested.id)) : [];

  return {
    amountCents: milestone.amountCents,
    submissionId: tested?.id ?? null,
    checks: (await signedChecks(db, milestoneId)).map((check) => {
      const ai = rows.find((row) => row.criterionId === check.id && row.source === 'ai');
      const client = rows.find((row) => row.criterionId === check.id && row.source === 'client');
      return {
        description: check.description,
        shareCents: check.shareCents,
        outcome: finalOutcome((ai?.verdict as AiVerdict | undefined) ?? null, (client?.verdict as ClientDecision | undefined) ?? null),
        summary: client?.verdict === 'rejected' ? client.summary : (ai?.summary ?? ''),
      };
    }),
  };
}

export async function proposeSettlement(
  db: Db,
  milestoneId: string,
  input: { now: Date; windowSeconds: number },
): Promise<'proposed' | 'cancelled' | 'skipped'> {
  return db.transaction(async (tx) => {
    const [milestone] = await tx.select().from(milestones).where(eq(milestones.id, milestoneId)).for('update');
    if (milestone?.state !== 'settlement_proposed') return 'skipped';
    const existing = await tx
      .select({ id: settlements.id })
      .from(settlements)
      .where(and(eq(settlements.milestoneId, milestoneId), eq(settlements.outcome, 'pending')))
      .limit(1);
    if (existing.length > 0) return 'skipped';

    const { amountCents, submissionId, checks } = await settlementChecks(tx, milestoneId);
    const split = proposeSplit(amountCents, checks.map((check) => ({ weight: check.shareCents, outcome: check.outcome })));
    const nothing = split.freelancerCents === 0;

    await tx.insert(settlements).values({
      milestoneId,
      submissionId,
      freelancerCents: split.freelancerCents,
      clientCents: split.clientCents,
      explanation: explainSplit(amountCents, checks, split),
      outcome: nothing ? 'cancelled' : 'pending',
      dueAt: new Date(input.now.getTime() + input.windowSeconds * 1000),
      createdAt: input.now,
      decidedAt: nothing ? input.now : null,
    });

    if (nothing) {
      // Nothing to capture, so the hold goes back to the client straight away.
      const applied = await applyEvent(tx, milestoneId, { type: 'settlement_declined' }, { now: input.now });
      if (!applied.ok) throw new Error(`Cancelling a split worth nothing was refused: ${applied.reason}`);
      return 'cancelled';
    }
    return 'proposed';
  });
}

/** Replaces the plain explanation with Claude's, leaving the plain one when Claude fails. */
export async function improveExplanation(db: Db, model: StructuredModel, milestoneId: string): Promise<void> {
  const [row] = await db
    .select()
    .from(settlements)
    .where(and(eq(settlements.milestoneId, milestoneId), eq(settlements.outcome, 'pending')))
    .orderBy(desc(settlements.createdAt))
    .limit(1);
  if (!row) return;
  const [milestone] = await db.select({ title: milestones.title }).from(milestones).where(eq(milestones.id, milestoneId));
  const { amountCents, checks } = await settlementChecks(db, milestoneId);
  try {
    const explanation = await explainSettlement(model, {
      title: milestone.title,
      amountCents,
      freelancerCents: row.freelancerCents,
      clientCents: row.clientCents,
      checks,
    });
    await db.update(settlements).set({ explanation }).where(eq(settlements.id, row.id));
  } catch (error) {
    console.error(`Explaining the split for milestone ${milestoneId} failed; the plain explanation stays`, error);
  }
}
