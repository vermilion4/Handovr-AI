import { randomUUID } from 'node:crypto';
import { and, asc, eq, lt } from 'drizzle-orm';
import { holds, milestones, paymentEvents, projects, type Db } from '../db/schema';
import { holdTotalCents } from '../domain/hold';
import { isFinal } from '../domain/milestone-state';
import { GatewayError, type PaymentGateway } from './gateway';
import { applyEvent } from './milestone-events';

/** Thrown inside the transaction to undo the hold's activation when the milestone cannot take it. */
class MilestoneRefusedHold extends Error {}

export type FundingProblem = 'not_found' | 'closed' | 'unreachable' | 'declined' | 'refused';

async function holdForClient(db: Db, holdId: string, userId: string) {
  const [row] = await db
    .select({ hold: holds, milestone: milestones, project: projects })
    .from(holds)
    .innerJoin(milestones, eq(milestones.id, holds.milestoneId))
    .innerJoin(projects, eq(projects.id, milestones.projectId))
    .where(eq(holds.id, holdId))
    .limit(1);
  return row && row.project.clientId === userId ? row : null;
}

export async function startFunding(
  db: Db,
  gateway: PaymentGateway,
  input: { milestoneId: string; userId: string; origin: string },
): Promise<{ ok: true; approveUrl: string } | { ok: false; reason: string }> {
  const [row] = await db
    .select({ milestone: milestones, project: projects })
    .from(milestones)
    .innerJoin(projects, eq(projects.id, milestones.projectId))
    .where(eq(milestones.id, input.milestoneId))
    .limit(1);
  if (!row || row.project.clientId !== input.userId) {
    return { ok: false, reason: 'Only the client on this project can fund it.' };
  }
  const { milestone, project } = row;
  if (milestone.state !== 'signed' && milestone.state !== 'funding_problem') {
    return { ok: false, reason: 'This milestone is not waiting to be funded.' };
  }

  const earlier = await db
    .select({ title: milestones.title, state: milestones.state })
    .from(milestones)
    .where(and(eq(milestones.projectId, project.id), lt(milestones.position, milestone.position)))
    .orderBy(asc(milestones.position));
  const unfinished = earlier.find((other) => !isFinal(other.state));
  if (unfinished) return { ok: false, reason: `Finish "${unfinished.title}" before funding this milestone.` };

  const holdId = randomUUID();
  const requestId = randomUUID();
  const totalCents = holdTotalCents(milestone.amountCents);

  let order: { orderId: string; approveUrl: string };
  try {
    order = await gateway.createHoldOrder({
      requestId,
      totalCents,
      description: `${project.title}: ${milestone.title}`,
      returnUrl: `${input.origin}/api/paypal/return?hold=${holdId}`,
      cancelUrl: `${input.origin}/api/paypal/cancel?hold=${holdId}`,
    });
  } catch (error) {
    if (!(error instanceof GatewayError)) throw error;
    console.error('Creating the PayPal order failed', error);
    return { ok: false, reason: 'PayPal could not be reached. Try again in a moment.' };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(holds)
      .set({ status: 'abandoned' })
      .where(and(eq(holds.milestoneId, milestone.id), eq(holds.status, 'awaiting_approval')));
    await tx.insert(holds).values({
      id: holdId,
      milestoneId: milestone.id,
      requestId,
      paypalOrderId: order.orderId,
      amountCents: milestone.amountCents,
      totalCents,
    });
  });
  return { ok: true, approveUrl: order.approveUrl };
}

export async function confirmFunding(
  db: Db,
  gateway: PaymentGateway,
  input: { holdId: string; userId: string; now: Date },
): Promise<
  | { ok: true; projectId: string; milestoneId: string }
  | { ok: false; problem: FundingProblem; reason: string; projectId?: string; milestoneId?: string }
> {
  const row = await holdForClient(db, input.holdId, input.userId);
  if (!row) return { ok: false, problem: 'not_found', reason: 'That payment could not be found.' };

  const where = { projectId: row.project.id, milestoneId: row.milestone.id };
  if (row.hold.status === 'active') return { ok: true, ...where };
  if (row.hold.status !== 'awaiting_approval') {
    return { ok: false, problem: 'closed', reason: 'That payment attempt is no longer open. Start again from the milestone.', ...where };
  }

  let placed: Awaited<ReturnType<PaymentGateway['authorizeOrder']>>;
  try {
    placed = await gateway.authorizeOrder({ requestId: row.hold.id, orderId: row.hold.paypalOrderId });
  } catch (error) {
    if (!(error instanceof GatewayError)) throw error;
    console.error('Placing the hold failed', error);
    return { ok: false, problem: 'unreachable', reason: 'PayPal could not be reached, so the hold was not confirmed.', ...where };
  }

  if ('declined' in placed) {
    const [dropped] = await db
      .update(holds)
      .set({ status: 'abandoned' })
      .where(and(eq(holds.id, row.hold.id), eq(holds.status, 'awaiting_approval')))
      .returning({ id: holds.id });
    // Another request finished placing this hold in the meantime.
    if (!dropped) {
      const [current] = await db.select({ status: holds.status }).from(holds).where(eq(holds.id, row.hold.id));
      if (current?.status === 'active') return { ok: true, ...where };
    }
    return { ok: false, problem: 'declined', reason: 'PayPal did not place the hold. Nothing was taken from your account.', ...where };
  }

  const authorization = placed;
  const funded = await db.transaction(async (tx) => {
    // Only one request can take the hold from awaiting approval to active.
    const [claimed] = await tx
      .update(holds)
      .set({
        status: 'active',
        authorizationId: authorization.authorizationId,
        authorizedAt: input.now,
        expiresAt: authorization.expiresAt,
      })
      .where(and(eq(holds.id, row.hold.id), eq(holds.status, 'awaiting_approval')))
      .returning({ id: holds.id });
    if (!claimed) return 'already';

    await tx.insert(paymentEvents).values({
      milestoneId: row.milestone.id,
      holdId: row.hold.id,
      type: 'hold',
      status: 'completed',
      amountCents: row.hold.totalCents,
      paypalId: authorization.authorizationId,
      createdAt: input.now,
      updatedAt: input.now,
    });

    const applied = await applyEvent(tx, row.milestone.id, { type: 'hold_confirmed' }, { now: input.now });
    if (!applied.ok) throw new MilestoneRefusedHold();
    return 'funded';
  }).catch((error) => {
    if (error instanceof MilestoneRefusedHold) return 'refused' as const;
    throw error;
  });

  if (funded === 'refused') {
    const cancelled = await gateway.voidAuthorization(authorization.authorizationId).then(
      () => true,
      (error) => {
        console.error('Cancelling the refused hold failed; it is queued to be cancelled later', error);
        return false;
      },
    );
    await db.transaction(async (tx) => {
      await tx
        .update(holds)
        .set({ status: cancelled ? 'voided' : 'invalid', authorizationId: authorization.authorizationId })
        .where(eq(holds.id, row.hold.id));
      if (!cancelled) {
        await tx.insert(paymentEvents).values({
          milestoneId: row.milestone.id,
          holdId: row.hold.id,
          type: 'void',
          status: 'pending',
          amountCents: row.hold.totalCents,
          createdAt: input.now,
          updatedAt: input.now,
        });
      }
    });
    return { ok: false, problem: 'refused', reason: 'This milestone is no longer waiting to be funded. The hold was cancelled.', ...where };
  }
  return { ok: true, ...where };
}

export async function cancelFunding(
  db: Db,
  input: { holdId: string; userId: string },
): Promise<{ projectId: string; milestoneId: string } | null> {
  const row = await holdForClient(db, input.holdId, input.userId);
  if (!row) return null;
  await db
    .update(holds)
    .set({ status: 'abandoned' })
    .where(and(eq(holds.id, row.hold.id), eq(holds.status, 'awaiting_approval')));
  return { projectId: row.project.id, milestoneId: row.milestone.id };
}
