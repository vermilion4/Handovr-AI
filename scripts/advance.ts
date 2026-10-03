import { asc, eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { milestones, paymentEvents } from '../src/db/schema';
import { MILESTONE_STATES, type MilestoneEventType } from '../src/domain/milestone-state';
import { liveGateway } from '../src/payments/live';
import { applyEvent } from '../src/payments/milestone-events';
import { checkPayouts, processPayments } from '../src/payments/processor';

const [milestoneId, ...eventTypes] = process.argv.slice(2);

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('This script is for development only.');
  if (!milestoneId || eventTypes.length === 0) {
    throw new Error('Usage: pnpm demo:advance <milestone id> <event> [event...]\nFor a full release: work_submitted verification_passed client_approved');
  }

  for (const type of eventTypes) {
    const result = await applyEvent(db, milestoneId, { type: type as MilestoneEventType }, { now: new Date() });
    console.log(type, '→', result.ok ? result.state : `refused: ${result.reason}`);
    if (!result.ok) break;
  }

  const gateway = liveGateway();
  await processPayments(db, gateway, new Date());

  const stateNow = async () => (await db.select().from(milestones).where(eq(milestones.id, milestoneId)))[0]?.state;
  for (let attempt = 0; attempt < 12 && (await stateNow()) === 'releasing'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await checkPayouts(db, gateway, new Date());
  }

  const state = await stateNow();
  console.log('\nMilestone is now:', state && MILESTONE_STATES.includes(state) ? state : 'not found');
  const events = await db
    .select()
    .from(paymentEvents)
    .where(eq(paymentEvents.milestoneId, milestoneId))
    .orderBy(asc(paymentEvents.createdAt));
  for (const event of events) {
    console.log(`  ${event.type.padEnd(8)} ${event.status.padEnd(10)} ${String(event.amountCents).padStart(8)}  ${event.paypalId ?? ''}  ${event.detail}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
