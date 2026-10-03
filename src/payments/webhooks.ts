import { and, eq } from 'drizzle-orm';
import { holds, paymentEvents, webhookEvents, type Db } from '../db/schema';
import type { PaymentGateway } from './gateway';
import { applyEvent } from './milestone-events';
import { checkPayouts } from './processor';

type Outcome = 'rejected' | 'duplicate' | 'handled' | 'ignored';

async function holdVoidedOutside(db: Db, gateway: PaymentGateway, authorizationId: string, now: Date): Promise<Outcome> {
  const [hold] = await db
    .select()
    .from(holds)
    .where(and(eq(holds.authorizationId, authorizationId), eq(holds.status, 'active'), eq(holds.simulated, false)))
    .limit(1);
  if (!hold) return 'ignored';

  const ownVoid = await db
    .select({ id: paymentEvents.id })
    .from(paymentEvents)
    .where(and(eq(paymentEvents.holdId, hold.id), eq(paymentEvents.type, 'void')))
    .limit(1);
  if (ownVoid.length > 0) return 'ignored';

  if ((await gateway.authorizationStatus(authorizationId)) !== 'voided') return 'ignored';

  return db.transaction(async (tx) => {
    const applied = await applyEvent(tx, hold.milestoneId, { type: 'hold_invalid' }, { now });
    if (!applied.ok) return 'ignored';
    await tx.update(holds).set({ status: 'invalid' }).where(eq(holds.id, hold.id));
    return 'handled';
  });
}

export async function handleWebhook(
  db: Db,
  gateway: PaymentGateway,
  input: { headers: Headers; body: string; now: Date },
): Promise<Outcome> {
  let event: { id?: unknown; event_type?: unknown; resource?: { id?: unknown } };
  try {
    event = JSON.parse(input.body);
  } catch {
    return 'rejected';
  }
  if (typeof event?.id !== 'string' || typeof event.event_type !== 'string') return 'rejected';
  if (!(await gateway.verifyWebhook({ headers: input.headers, body: input.body }))) return 'rejected';

  const stored = await db
    .insert(webhookEvents)
    .values({ paypalEventId: event.id, eventType: event.event_type, receivedAt: input.now })
    .onConflictDoNothing()
    .returning();
  if (stored.length === 0) return 'duplicate';

  try {
    if (event.event_type.startsWith('PAYMENT.PAYOUTS')) {
      await checkPayouts(db, gateway, input.now);
      return 'handled';
    }
    if (event.event_type === 'PAYMENT.AUTHORIZATION.VOIDED' && typeof event.resource?.id === 'string') {
      return await holdVoidedOutside(db, gateway, event.resource.id, input.now);
    }
    return 'ignored';
  } catch (error) {
    // Forget the event so that PayPal's next delivery of it is acted on.
    await db.delete(webhookEvents).where(eq(webhookEvents.paypalEventId, event.id));
    throw error;
  }
}
