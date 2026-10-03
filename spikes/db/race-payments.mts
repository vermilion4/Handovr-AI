import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { and, eq } from 'drizzle-orm';
const R = '../../src';
const { schema, paymentEvents, holds, milestones } = await import(`${R}/db/schema.ts`);
const { setupMilestone, fakeGateway } = await import(`${R}/payments/testing.ts`);
const { applyEvent } = await import(`${R}/payments/milestone-events.ts`);
const { processPayments, retryFailedPayouts } = await import(`${R}/payments/processor.ts`);
const { startFunding, confirmFunding } = await import(`${R}/payments/funding.ts`);
const { GatewayError } = await import(`${R}/payments/gateway.ts`);

const sql = postgres(process.env.DATABASE_URL!, { max: 12 });
const db = drizzle({ client: sql, schema });
const now = new Date();
const ROUNDS = 15;
let extraRetries = 0, doubleSends = 0, doubleHolds = 0, doubleHoldEvents = 0;

for (let round = 0; round < ROUNDS; round++) {
  // Five runs retry the same failed payout at once.
  const gateway = fakeGateway();
  const a = await setupMilestone(db, { state: 'client_review' });
  await applyEvent(db, a.milestoneId, { type: 'client_approved' }, { now });
  gateway.failNext('sendPayout', new GatewayError('INSUFFICIENT_FUNDS', 422, 'INSUFFICIENT_FUNDS'));
  await processPayments(db, gateway, now);
  await Promise.all(Array.from({ length: 5 }, () => retryFailedPayouts(db, now)));
  const payouts = await db.select().from(paymentEvents).where(and(eq(paymentEvents.milestoneId, a.milestoneId), eq(paymentEvents.type, 'payout')));
  if (payouts.length !== 2) extraRetries++;

  // Five runs process the same queue at once.
  await Promise.all(Array.from({ length: 5 }, () => processPayments(db, gateway, now)));
  if (gateway.callsTo('sendPayout').length !== 2 || gateway.callsTo('capture').length !== 1) doubleSends++;

  // PayPal's return address opened five times at once.
  const g2 = fakeGateway();
  const b = await setupMilestone(db, { state: 'signed', hold: null });
  await startFunding(db, g2, { milestoneId: b.milestoneId, userId: b.clientId, origin: 'http://x' });
  const [hold] = await db.select().from(holds).where(eq(holds.milestoneId, b.milestoneId));
  await Promise.all(Array.from({ length: 5 }, () => confirmFunding(db, g2, { holdId: hold.id, userId: b.clientId, now })));
  const active = await db.select().from(holds).where(and(eq(holds.milestoneId, b.milestoneId), eq(holds.status, 'active')));
  const holdEvents = await db.select().from(paymentEvents).where(eq(paymentEvents.milestoneId, b.milestoneId));
  const [m] = await db.select().from(milestones).where(eq(milestones.id, b.milestoneId));
  if (active.length !== 1 || m.state !== 'funded') doubleHolds++;
  if (holdEvents.length !== 1) doubleHoldEvents++;
}
console.log(JSON.stringify({ rounds: ROUNDS, extraRetries, doubleSends, doubleHolds, doubleHoldEvents }));
await sql.end();
