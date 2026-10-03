import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { holds, milestones, paymentEvents, users, type Db } from '../db/schema';
import { createTestDb } from '../db/test-db';
import { GatewayError } from './gateway';
import { applyEvent } from './milestone-events';
import { checkPayouts, processPayments, requeueStuck, retryFailedPayouts } from './processor';
import { fakeGateway, setupMilestone, type FakeGateway, type MilestoneFixture } from './testing';

const now = new Date('2026-10-10T12:00:00Z');
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
const refusal = (issue: string) => new GatewayError(issue, 422, issue);

let db: Db;
let gateway: FakeGateway;
let fixture: MilestoneFixture;

async function releasing(options: { simulated?: boolean } = {}): Promise<void> {
  fixture = await setupMilestone(db, { state: 'client_review', simulated: options.simulated });
  await applyEvent(db, fixture.milestoneId, { type: 'client_approved' }, { now });
}

const events = async () =>
  (await db.select().from(paymentEvents).where(eq(paymentEvents.milestoneId, fixture.milestoneId)).orderBy(asc(paymentEvents.createdAt))).map(
    (row) => [row.type, row.status],
  );
const eventRows = () =>
  db.select().from(paymentEvents).where(eq(paymentEvents.milestoneId, fixture.milestoneId)).orderBy(asc(paymentEvents.createdAt));
const stateNow = async () => (await db.select().from(milestones).where(eq(milestones.id, fixture.milestoneId)))[0].state;
const holdStatus = async () => (await db.select().from(holds).where(eq(holds.id, fixture.holdId!)))[0].status;

beforeEach(async () => {
  db = await createTestDb();
  gateway = fakeGateway();
});

describe('a full release', () => {
  it('captures the hold, then sends the payout to the freelancer', async () => {
    await releasing();
    await processPayments(db, gateway, now);

    const [capture, payout] = await eventRows();
    expect(gateway.callsTo('capture')).toEqual([
      { requestId: capture.requestId, authorizationId: 'AUTH-0', amountCents: 61823, note: "Chen's Bakery website: Contact page" },
    ]);
    const [freelancer] = await db.select().from(users).where(eq(users.id, fixture.freelancerId));
    expect(gateway.callsTo('sendPayout')).toEqual([
      { batchId: payout.requestId, email: freelancer.email, amountCents: 60000, note: "Chen's Bakery website: Contact page" },
    ]);
    expect(await events()).toEqual([['capture', 'completed'], ['payout', 'sent']]);
    expect(await holdStatus()).toBe('captured');
    expect(await stateNow()).toBe('releasing');
  });

  it('releases the milestone once PayPal reports the payout paid', async () => {
    await releasing();
    await processPayments(db, gateway, now);

    await checkPayouts(db, gateway, now);
    expect(await stateNow()).toBe('releasing');

    gateway.payoutState = { status: 'success', detail: 'unclaimed' };
    await checkPayouts(db, gateway, later(1));
    expect(await events()).toEqual([['capture', 'completed'], ['payout', 'completed']]);
    expect((await eventRows())[1].detail).toBe('unclaimed');
    expect(await stateNow()).toBe('released');
  });

  it('sends nothing twice when run again, or run twice at once', async () => {
    await releasing();
    await Promise.all([processPayments(db, gateway, now), processPayments(db, gateway, now)]);
    await processPayments(db, gateway, later(1));
    expect(gateway.callsTo('capture')).toHaveLength(1);
    expect(gateway.callsTo('sendPayout')).toHaveLength(1);
  });
});

describe('when the capture fails', () => {
  it('moves to a funding problem and pays nothing when PayPal refuses', async () => {
    await releasing();
    gateway.failNext('capture', refusal('AUTHORIZATION_VOIDED'));
    await processPayments(db, gateway, now);

    expect(await events()).toEqual([['capture', 'failed'], ['payout', 'failed'], ['void', 'completed']]);
    expect((await eventRows())[0].detail).toContain('AUTHORIZATION_VOIDED');
    expect(gateway.callsTo('voidAuthorization')).toEqual(['AUTH-0']);
    expect(await holdStatus()).toBe('voided');
    expect(await stateNow()).toBe('funding_problem');
    expect(gateway.callsTo('sendPayout')).toEqual([]);
  });

  it('tries again later with the same request id when PayPal cannot be reached', async () => {
    await releasing();
    gateway.failNext('capture');
    gateway.failNext('capture');
    await processPayments(db, gateway, now);
    expect(await events()).toEqual([['capture', 'pending'], ['payout', 'blocked']]);
    expect(await stateNow()).toBe('releasing');

    await processPayments(db, gateway, later(5));
    expect(await events()).toEqual([['capture', 'completed'], ['payout', 'sent']]);
    const requestIds = (gateway.callsTo('capture') as Array<{ requestId: string }>).map((call) => call.requestId);
    expect(new Set(requestIds).size).toBe(1);
    expect((await eventRows())[0].attempts).toBe(3);
  });
});

describe('when the payout fails', () => {
  it('stays releasing when PayPal refuses the payout, and a new batch is sent on retry', async () => {
    await releasing();
    gateway.failNext('sendPayout', refusal('INSUFFICIENT_FUNDS'));
    await processPayments(db, gateway, now);
    expect(await events()).toEqual([['capture', 'completed'], ['payout', 'failed']]);
    expect(await stateNow()).toBe('releasing');

    await retryFailedPayouts(db, later(5));
    await retryFailedPayouts(db, later(5));
    expect(await events()).toEqual([['capture', 'completed'], ['payout', 'failed'], ['payout', 'pending']]);

    await processPayments(db, gateway, later(5));
    const batches = (gateway.callsTo('sendPayout') as Array<{ batchId: string }>).map((call) => call.batchId);
    expect(new Set(batches).size).toBe(2);
    expect(await events()).toEqual([['capture', 'completed'], ['payout', 'failed'], ['payout', 'sent']]);
  });

  it('queues a new payout when PayPal later reports the sent one failed', async () => {
    await releasing();
    await processPayments(db, gateway, now);
    gateway.payoutState = { status: 'failed', detail: 'Receiver is blocked' };
    await checkPayouts(db, gateway, later(1));
    expect(await events()).toEqual([['capture', 'completed'], ['payout', 'failed']]);
    expect((await eventRows())[1].detail).toBe('Receiver is blocked');
    expect(await stateNow()).toBe('releasing');

    await retryFailedPayouts(db, later(2));
    expect((await events()).at(-1)).toEqual(['payout', 'pending']);
  });

  it('stops retrying after five payouts', async () => {
    await releasing();
    for (let attempt = 0; attempt < 7; attempt++) {
      gateway.failNext('sendPayout', refusal('INSUFFICIENT_FUNDS'));
      await processPayments(db, gateway, later(attempt));
      await retryFailedPayouts(db, later(attempt));
    }
    expect((await events()).filter(([type]) => type === 'payout')).toHaveLength(5);
  });

  it('does not retry a payout that failed only because its capture did', async () => {
    await releasing();
    gateway.failNext('capture', refusal('AUTHORIZATION_VOIDED'));
    await processPayments(db, gateway, now);
    await retryFailedPayouts(db, later(5));
    expect((await events()).filter(([type]) => type === 'payout')).toEqual([['payout', 'failed']]);
  });
});

describe('when PayPal rejects our credentials or our request', () => {
  it('keeps the capture queued and the hold intact, so nothing is undone by a bad key', async () => {
    await releasing();
    gateway.failNext('capture', new GatewayError('unauthorised', 401));
    gateway.failNext('capture', new GatewayError('bad request', 400));
    await processPayments(db, gateway, now);
    expect(await events()).toEqual([['capture', 'pending'], ['payout', 'blocked']]);
    expect(await holdStatus()).toBe('active');
    expect(await stateNow()).toBe('releasing');
  });

  it('keeps a payout queued under the same batch, so it can never become a second payout', async () => {
    await releasing();
    gateway.failNext('sendPayout', new GatewayError('bad request', 400));
    gateway.failNext('sendPayout', new GatewayError('forbidden', 403));
    await processPayments(db, gateway, now);
    await retryFailedPayouts(db, later(1));
    await processPayments(db, gateway, later(1));
    const batches = (gateway.callsTo('sendPayout') as Array<{ batchId: string }>).map((call) => call.batchId);
    expect(new Set(batches).size).toBe(1);
    expect((await events()).filter(([type]) => type === 'payout')).toEqual([['payout', 'sent']]);
  });
});

describe('queue safety', () => {
  it('queues one retry when two runs look at the same failed payout together', async () => {
    await releasing();
    gateway.failNext('sendPayout', refusal('INSUFFICIENT_FUNDS'));
    await processPayments(db, gateway, now);
    await Promise.all([retryFailedPayouts(db, later(5)), retryFailedPayouts(db, later(5)), retryFailedPayouts(db, later(5))]);
    expect((await events()).filter(([type]) => type === 'payout')).toEqual([['payout', 'failed'], ['payout', 'pending']]);
  });

  it('queues one retry even when the retry carries the same time as the failed payout', async () => {
    await releasing();
    gateway.failNext('sendPayout', refusal('INSUFFICIENT_FUNDS'));
    await processPayments(db, gateway, now);
    await retryFailedPayouts(db, now);
    await retryFailedPayouts(db, now);
    expect((await events()).filter(([type]) => type === 'payout').map(([, status]) => status).sort()).toEqual(['failed', 'pending']);
  });

  it('carries on with the other rows when one row hits an unexpected error', async () => {
    await releasing();
    const first = fixture;
    await releasing();
    gateway.failNext('capture', new Error('unexpected'));
    await processPayments(db, gateway, now);
    const captured = (gateway.callsTo('capture') as Array<{ requestId: string }>).length;
    expect(captured).toBeGreaterThanOrEqual(2);
    expect((await db.select().from(paymentEvents).where(eq(paymentEvents.milestoneId, first.milestoneId))).some((row) => row.status === 'completed')).toBe(true);
  });

  it('leaves renewals to the tick: a renew row is never picked up or returned to the queue', async () => {
    await releasing();
    await db.insert(paymentEvents).values({ milestoneId: fixture.milestoneId, holdId: fixture.holdId!, type: 'renew', status: 'sending', amountCents: 61823, createdAt: now, updatedAt: now });
    await requeueStuck(db, later(10));
    await processPayments(db, gateway, later(10));
    expect((await events()).find(([type]) => type === 'renew')).toEqual(['renew', 'sending']);
  });
});

describe('a void', () => {
  async function cancelled(): Promise<void> {
    fixture = await setupMilestone(db, { state: 'settlement_proposed' });
    await applyEvent(db, fixture.milestoneId, { type: 'settlement_declined' }, { now });
  }

  it('cancels the hold at PayPal', async () => {
    await cancelled();
    await processPayments(db, gateway, now);
    expect(gateway.callsTo('voidAuthorization')).toEqual(['AUTH-0']);
    expect(await events()).toEqual([['void', 'completed']]);
    expect(await holdStatus()).toBe('voided');
  });

  it('counts a refusal as done when PayPal says the hold is already void', async () => {
    await cancelled();
    gateway.failNext('voidAuthorization', refusal('SOMETHING'));
    gateway.authorizationState = 'voided';
    await processPayments(db, gateway, now);
    expect(await events()).toEqual([['void', 'completed']]);
  });

  it('counts a hold that has already ended at PayPal as cancelled', async () => {
    await cancelled();
    gateway.failNext('voidAuthorization', refusal('AUTHORIZATION_EXPIRED'));
    gateway.authorizationState = 'other';
    await processPayments(db, gateway, now);
    expect(await events()).toEqual([['void', 'completed']]);
  });

  it('records a failure when the hold is refused and still not void', async () => {
    await cancelled();
    gateway.failNext('voidAuthorization', refusal('SOMETHING'));
    gateway.authorizationState = 'captured';
    await processPayments(db, gateway, now);
    expect(await events()).toEqual([['void', 'failed']]);
  });
});

describe('a simulated hold', () => {
  it('completes the whole release without calling PayPal', async () => {
    await releasing({ simulated: true });
    await processPayments(db, gateway, now);
    expect(gateway.calls).toEqual([]);
    expect(await events()).toEqual([['capture', 'completed'], ['payout', 'completed']]);
    expect(await stateNow()).toBe('released');
  });
});

describe('requeueStuck', () => {
  it('returns a row left mid-send for over two minutes to the queue', async () => {
    await releasing();
    const [capture] = await eventRows();
    await db.update(paymentEvents).set({ status: 'sending', updatedAt: now }).where(eq(paymentEvents.id, capture.id));

    await requeueStuck(db, later(1));
    expect((await events())[0]).toEqual(['capture', 'sending']);
    await requeueStuck(db, later(3));
    expect((await events())[0]).toEqual(['capture', 'pending']);
  });
});
