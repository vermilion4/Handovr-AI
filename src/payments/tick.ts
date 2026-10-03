import { createHash, timingSafeEqual } from 'node:crypto';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { holds, paymentEvents, type Db } from '../db/schema';
import { holdAction } from '../domain/hold';
import { GatewayError, type PaymentGateway } from './gateway';
import { applyEvent } from './milestone-events';
import { checkPayouts, processPayments, requeueStuck, retryFailedPayouts } from './processor';

export interface TickReport {
  renewed: number;
  expired: number;
  errors: string[];
}

type Hold = typeof holds.$inferSelect;

async function renew(db: Db, gateway: PaymentGateway, hold: Hold, now: Date): Promise<boolean> {
  // An unfinished attempt is sent again under its own request id, so PayPal answers with the same renewal.
  const [unfinished] = await db
    .select()
    .from(paymentEvents)
    .where(
      and(
        eq(paymentEvents.holdId, hold.id),
        eq(paymentEvents.type, 'renew'),
        inArray(paymentEvents.status, ['pending', 'sending']),
      ),
    )
    .limit(1);
  const [row] = unfinished
    ? [unfinished]
    : await db
        .insert(paymentEvents)
        .values({
          milestoneId: hold.milestoneId,
          holdId: hold.id,
          type: 'renew',
          status: 'sending',
          amountCents: hold.totalCents,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

  try {
    const renewed = await gateway.reauthorize({
      requestId: row.requestId,
      authorizationId: hold.authorizationId!,
      totalCents: hold.totalCents,
    });
    await db.transaction(async (tx) => {
      await tx
        .update(holds)
        .set({ authorizationId: renewed.authorizationId, expiresAt: renewed.expiresAt, renewedAt: now })
        .where(eq(holds.id, hold.id));
      await tx
        .update(paymentEvents)
        .set({ status: 'completed', paypalId: renewed.authorizationId, updatedAt: now })
        .where(eq(paymentEvents.id, row.id));
    });
    return true;
  } catch (error) {
    if (!(error instanceof GatewayError)) throw error;
    if (error.refused) {
      // PayPal will not renew this hold, so stop asking and let it run to its expiry.
      await db.update(holds).set({ renewedAt: now }).where(eq(holds.id, hold.id));
      await db
        .update(paymentEvents)
        .set({ status: 'failed', detail: error.message, updatedAt: now })
        .where(eq(paymentEvents.id, row.id));
    } else {
      await db
        .update(paymentEvents)
        .set({ detail: error.message, updatedAt: now })
        .where(eq(paymentEvents.id, row.id));
    }
    return false;
  }
}

async function expire(db: Db, hold: Hold, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const applied = await applyEvent(tx, hold.milestoneId, { type: 'hold_expired' }, { now });
    if (!applied.ok) return false;
    await tx.update(holds).set({ status: 'expired' }).where(eq(holds.id, hold.id));
    return true;
  });
}

export async function runTick(db: Db, gateway: PaymentGateway, now: Date): Promise<TickReport> {
  const report: TickReport = { renewed: 0, expired: 0, errors: [] };
  const step = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      console.error(`Tick step "${name}" failed`, error);
      report.errors.push(`${name}: ${error instanceof Error ? error.message : error}`);
    }
  };

  await step('requeue', () => requeueStuck(db, now));
  await step('send', () => processPayments(db, gateway, now));
  await step('payouts', () => checkPayouts(db, gateway, now));
  await step('retry', async () => {
    await retryFailedPayouts(db, now);
    await processPayments(db, gateway, now);
  });

  const live = await db
    .select()
    .from(holds)
    .where(and(eq(holds.status, 'active'), eq(holds.simulated, false), isNotNull(holds.authorizedAt)));

  for (const hold of live) {
    const action = holdAction({ authorizedAt: hold.authorizedAt!, expiresAt: hold.expiresAt!, renewedAt: hold.renewedAt }, now);
    if (action === 'renew') {
      await step('renew', async () => {
        if (await renew(db, gateway, hold, now)) report.renewed += 1;
      });
    }
    if (action === 'expire') {
      await step('expire', async () => {
        if (await expire(db, hold, now)) report.expired += 1;
      });
    }
  }
  return report;
}

const digest = (value: string) => createHash('sha256').update(value).digest();

export function validTickKey(given: string | null, secret: string | undefined): boolean {
  if (!given || !secret) return false;
  return timingSafeEqual(digest(given), digest(secret));
}
