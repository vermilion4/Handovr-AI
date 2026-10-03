import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { holds, milestones, paymentEvents, projects, users, type Db } from '../db/schema';
import { noNotice, type Notice } from '../notifications/notice';
import { GatewayError, type PaymentGateway } from './gateway';
import { applyEvent } from './milestone-events';

export const MAX_PAYOUT_TRIES = 5;
const STUCK_AFTER_MS = 2 * 60 * 1000;

/** The rows this processor sends. Renewals are sent by the tick. */
const QUEUED_TYPES = ['capture', 'payout', 'void'] as const;

type PaymentEvent = typeof paymentEvents.$inferSelect;
type Hold = typeof holds.$inferSelect;

async function finish(db: Db, eventId: string, patch: Partial<typeof paymentEvents.$inferInsert>, now: Date): Promise<void> {
  await db.update(paymentEvents).set({ ...patch, updatedAt: now }).where(eq(paymentEvents.id, eventId));
}

async function describeMilestone(db: Db, milestoneId: string) {
  const [row] = await db
    .select({ note: sql<string>`${projects.title} || ': ' || ${milestones.title}`, email: users.email })
    .from(milestones)
    .innerJoin(projects, eq(projects.id, milestones.projectId))
    .innerJoin(users, eq(users.id, projects.freelancerId))
    .where(eq(milestones.id, milestoneId));
  return row;
}

async function sendCapture(db: Db, gateway: PaymentGateway, event: PaymentEvent, hold: Hold, now: Date): Promise<void> {
  const captureId = hold.simulated
    ? 'SIMULATED'
    : (
        await gateway.capture({
          requestId: event.requestId,
          authorizationId: hold.authorizationId!,
          amountCents: event.amountCents,
          note: (await describeMilestone(db, event.milestoneId)).note,
        })
      ).captureId;

  await db.transaction(async (tx) => {
    await finish(tx, event.id, { status: 'completed', paypalId: captureId, detail: '' }, now);
    await tx.update(holds).set({ status: 'captured' }).where(eq(holds.id, hold.id));
    await tx
      .update(paymentEvents)
      .set({ status: 'pending', updatedAt: now })
      .where(
        and(
          eq(paymentEvents.milestoneId, event.milestoneId),
          eq(paymentEvents.type, 'payout'),
          eq(paymentEvents.status, 'blocked'),
        ),
      );
  });
}

async function captureRefused(db: Db, event: PaymentEvent, hold: Hold, error: GatewayError, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await finish(tx, event.id, { status: 'failed', detail: error.message }, now);
    await tx.update(holds).set({ status: 'invalid' }).where(eq(holds.id, hold.id));
    await tx
      .update(paymentEvents)
      .set({ status: 'failed', detail: 'The capture did not go through.', updatedAt: now })
      .where(
        and(
          eq(paymentEvents.milestoneId, event.milestoneId),
          eq(paymentEvents.type, 'payout'),
          eq(paymentEvents.status, 'blocked'),
        ),
      );
    // Cancel whatever is left of the hold, so the client is not held twice after funding again.
    const after = new Date(now.getTime() + 2);
    await tx.insert(paymentEvents).values({
      milestoneId: event.milestoneId,
      holdId: hold.id,
      type: 'void',
      status: 'pending',
      amountCents: hold.totalCents,
      createdAt: after,
      updatedAt: after,
    });
    const applied = await applyEvent(tx, event.milestoneId, { type: 'capture_failed' }, { now });
    if (!applied.ok) console.error(`capture_failed was refused for milestone ${event.milestoneId}: ${applied.reason}`);
  });
}

async function confirmPayout(db: Db, event: PaymentEvent, paypalId: string, detail: string, now: Date, notice: Notice): Promise<void> {
  const released = await db.transaction(async (tx) => {
    await finish(tx, event.id, { status: 'completed', paypalId, detail }, now);
    const applied = await applyEvent(tx, event.milestoneId, { type: 'payout_confirmed' }, { now });
    if (!applied.ok) console.error(`payout_confirmed was refused for milestone ${event.milestoneId}: ${applied.reason}`);
    return applied.ok;
  });
  if (released) await notice('paid', event.milestoneId);
}

async function sendPayout(db: Db, gateway: PaymentGateway, event: PaymentEvent, hold: Hold, now: Date, notice: Notice): Promise<void> {
  if (hold.simulated) {
    await confirmPayout(db, event, 'SIMULATED', '', now, notice);
    return;
  }
  const { note, email } = await describeMilestone(db, event.milestoneId);
  const { payoutBatchId } = await gateway.sendPayout({
    batchId: event.requestId,
    email,
    amountCents: event.amountCents,
    note,
  });
  await finish(db, event.id, { status: 'sent', paypalId: payoutBatchId, detail: '' }, now);
}

async function sendVoid(db: Db, gateway: PaymentGateway, event: PaymentEvent, hold: Hold, now: Date): Promise<void> {
  if (!hold.simulated) {
    try {
      await gateway.voidAuthorization(hold.authorizationId!);
    } catch (error) {
      if (!(error instanceof GatewayError) || !error.refused) throw error;
      // A hold that has expired or been voided already has nothing left to cancel.
      const status = await gateway.authorizationStatus(hold.authorizationId!);
      if (status === 'active' || status === 'captured') throw error;
    }
  }
  await db.transaction(async (tx) => {
    await finish(tx, event.id, { status: 'completed', paypalId: hold.authorizationId, detail: '' }, now);
    await tx.update(holds).set({ status: 'voided' }).where(eq(holds.id, hold.id));
  });
}

async function processOne(db: Db, gateway: PaymentGateway, eventId: string, now: Date, notice: Notice): Promise<void> {
  // Taking the row from pending to sending is what stops two runs sending the same thing.
  const [event] = await db
    .update(paymentEvents)
    .set({ status: 'sending', updatedAt: new Date(), attempts: sql`${paymentEvents.attempts} + 1` })
    .where(and(eq(paymentEvents.id, eventId), eq(paymentEvents.status, 'pending')))
    .returning();
  if (!event) return;

  const [hold] = await db.select().from(holds).where(eq(holds.id, event.holdId));
  try {
    if (event.type === 'capture') await sendCapture(db, gateway, event, hold, now);
    else if (event.type === 'payout') await sendPayout(db, gateway, event, hold, now, notice);
    else if (event.type === 'void') await sendVoid(db, gateway, event, hold, now);
    else await finish(db, event.id, { status: 'failed', detail: `Nothing sends a ${event.type} row.` }, now);
  } catch (error) {
    if (!(error instanceof GatewayError)) {
      // Left in the queue for the next run, and the rows after it still get their turn.
      console.error(`Payment event ${event.id} hit an unexpected error`, error);
      await finish(db, event.id, { status: 'pending', detail: String(error) }, now);
    } else if (!error.refused) {
      await finish(db, event.id, { status: 'pending', detail: error.message }, now);
    } else if (event.type === 'capture') {
      await captureRefused(db, event, hold, error, now);
    } else {
      await finish(db, event.id, { status: 'failed', detail: error.message }, now);
    }
  }
}

export async function processPayments(db: Db, gateway: PaymentGateway, now: Date, notice: Notice = noNotice): Promise<void> {
  // The second pass sends payouts that the first pass's captures unblocked.
  for (let pass = 0; pass < 2; pass++) {
    const due = await db
      .select({ id: paymentEvents.id })
      .from(paymentEvents)
      .where(and(eq(paymentEvents.status, 'pending'), inArray(paymentEvents.type, QUEUED_TYPES)))
      .orderBy(asc(paymentEvents.createdAt));
    for (const { id } of due) await processOne(db, gateway, id, now, notice);
  }
}

export async function checkPayouts(db: Db, gateway: PaymentGateway, now: Date, notice: Notice = noNotice): Promise<void> {
  const sent = await db
    .select()
    .from(paymentEvents)
    .where(and(eq(paymentEvents.type, 'payout'), eq(paymentEvents.status, 'sent')));

  for (const event of sent) {
    try {
      const result = await gateway.payoutStatus(event.paypalId!);
      if (result.status === 'success') await confirmPayout(db, event, event.paypalId!, result.detail, now, notice);
      if (result.status === 'failed') await finish(db, event.id, { status: 'failed', detail: result.detail }, now);
    } catch (error) {
      if (!(error instanceof GatewayError)) throw error;
      console.error(`Reading payout ${event.paypalId} failed`, error);
    }
  }
}

export async function retryFailedPayouts(db: Db, now: Date): Promise<void> {
  const waiting = await db.select({ id: milestones.id }).from(milestones).where(eq(milestones.state, 'releasing'));

  for (const { id } of waiting) {
    await db.transaction(async (tx) => {
      // Locking the milestone means two runs cannot both queue a retry for the same failed payout.
      await tx.select({ id: milestones.id }).from(milestones).where(eq(milestones.id, id)).for('update');

      const payouts = await tx
        .select()
        .from(paymentEvents)
        .where(and(eq(paymentEvents.milestoneId, id), eq(paymentEvents.type, 'payout')))
        .orderBy(desc(paymentEvents.createdAt));
      const latest = payouts[0];
      if (!latest) return;

      // Only payouts for the hold that is now captured count; an earlier hold's failures are history.
      const [hold] = await tx.select().from(holds).where(eq(holds.id, latest.holdId));
      const forHold = payouts.filter((payout) => payout.holdId === latest.holdId);
      const anyUnfinishedOrPaid = forHold.some((payout) => payout.status !== 'failed');
      if (hold.status !== 'captured' || anyUnfinishedOrPaid || forHold.length >= MAX_PAYOUT_TRIES) return;

      await tx.insert(paymentEvents).values({
        milestoneId: id,
        holdId: latest.holdId,
        type: 'payout',
        status: 'pending',
        amountCents: latest.amountCents,
        createdAt: now,
        updatedAt: now,
      });
    });
  }
}

export async function requeueStuck(db: Db, now: Date): Promise<void> {
  await db
    .update(paymentEvents)
    .set({ status: 'pending', updatedAt: now })
    .where(
      and(
        eq(paymentEvents.status, 'sending'),
        inArray(paymentEvents.type, QUEUED_TYPES),
        lt(paymentEvents.updatedAt, new Date(now.getTime() - STUCK_AFTER_MS)),
      ),
    );
}
