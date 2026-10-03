import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { holds, milestones, paymentEvents, type Db } from '../db/schema';
import { createTestDb } from '../db/test-db';
import { cancelFunding, confirmFunding, startFunding } from './funding';
import { fakeGateway, setupMilestone, type FakeGateway, type MilestoneFixture } from './testing';

const now = new Date('2026-10-02T15:00:00Z');
const origin = 'http://127.0.0.1:3000';
let db: Db;
let gateway: FakeGateway;
let fixture: MilestoneFixture;

beforeEach(async () => {
  db = await createTestDb();
  gateway = fakeGateway();
  fixture = await setupMilestone(db, { state: 'signed', hold: null });
});

const holdRows = () => db.select().from(holds).where(eq(holds.milestoneId, fixture.milestoneId)).orderBy(holds.createdAt);
const stateNow = async () => (await db.select().from(milestones).where(eq(milestones.id, fixture.milestoneId)))[0].state;
const start = (userId = fixture.clientId) => startFunding(db, gateway, { milestoneId: fixture.milestoneId, userId, origin });

describe('startFunding', () => {
  it('creates a PayPal order for the amount plus the fee and remembers it', async () => {
    const result = await start();
    expect(result).toEqual({ ok: true, approveUrl: 'https://paypal.test/approve/ORDER-1' });

    const [hold] = await holdRows();
    expect(hold).toMatchObject({ paypalOrderId: 'ORDER-1', amountCents: 60000, totalCents: 61823, status: 'awaiting_approval', simulated: false });
    expect(gateway.callsTo('createHoldOrder')).toEqual([
      {
        requestId: hold.requestId,
        totalCents: 61823,
        description: "Chen's Bakery website: Contact page",
        returnUrl: `${origin}/api/paypal/return?hold=${hold.id}`,
        cancelUrl: `${origin}/api/paypal/cancel?hold=${hold.id}`,
      },
    ]);
    expect(await stateNow()).toBe('signed');
  });

  it('is refused for the freelancer and for a stranger, without calling PayPal', async () => {
    expect(await start(fixture.freelancerId)).toEqual({ ok: false, reason: 'Only the client on this project can fund it.' });
    expect(await start(fixture.strangerId)).toEqual({ ok: false, reason: 'Only the client on this project can fund it.' });
    expect(gateway.calls).toEqual([]);
  });

  it('is refused unless the milestone is signed or has a funding problem', async () => {
    await db.update(milestones).set({ state: 'drafting' }).where(eq(milestones.id, fixture.milestoneId));
    expect(await start()).toEqual({ ok: false, reason: 'This milestone is not waiting to be funded.' });
  });

  it('is refused while an earlier milestone is unfinished', async () => {
    await db.update(milestones).set({ position: 2 }).where(eq(milestones.id, fixture.milestoneId));
    await db.insert(milestones).values({ projectId: fixture.projectId, position: 1, title: 'Homepage', amountCents: 90000, state: 'funded' });
    expect(await start()).toEqual({ ok: false, reason: 'Finish "Homepage" before funding this milestone.' });
  });

  it('drops an earlier unapproved attempt when the client starts again', async () => {
    await start();
    await start();
    expect((await holdRows()).map((hold) => hold.status)).toEqual(['abandoned', 'awaiting_approval']);
  });

  it('reports PayPal being unreachable without leaving a hold behind', async () => {
    gateway.failNext('createHoldOrder');
    expect(await start()).toEqual({ ok: false, reason: 'PayPal could not be reached. Try again in a moment.' });
    expect(await holdRows()).toEqual([]);
  });
});

describe('confirmFunding', () => {
  async function started(): Promise<string> {
    await start();
    return (await holdRows())[0].id;
  }
  const confirm = (holdId: string, userId = fixture.clientId) => confirmFunding(db, gateway, { holdId, userId, now });

  it('places the hold, records it and moves the milestone to funded', async () => {
    const holdId = await started();
    expect(await confirm(holdId)).toEqual({ ok: true, projectId: fixture.projectId, milestoneId: fixture.milestoneId });

    const [hold] = await holdRows();
    expect(hold).toMatchObject({ status: 'active', authorizationId: 'AUTH-1', authorizedAt: now, expiresAt: new Date('2026-10-31T12:00:00Z') });
    expect(gateway.callsTo('authorizeOrder')).toEqual([{ requestId: holdId, orderId: 'ORDER-1' }]);
    expect(await db.select().from(paymentEvents)).toMatchObject([
      { type: 'hold', status: 'completed', amountCents: 61823, paypalId: 'AUTH-1', holdId },
    ]);
    expect(await stateNow()).toBe('funded');
  });

  it('does nothing the second time the return address is opened', async () => {
    const holdId = await started();
    await confirm(holdId);
    expect(await confirm(holdId)).toEqual({ ok: true, projectId: fixture.projectId, milestoneId: fixture.milestoneId });
    expect(gateway.callsTo('authorizeOrder')).toHaveLength(1);
    expect(await db.select().from(paymentEvents)).toHaveLength(1);
  });

  it('leaves the milestone unfunded when PayPal declines', async () => {
    const holdId = await started();
    gateway.authorizeResult = { declined: 'ORDER_NOT_APPROVED' };
    expect(await confirm(holdId)).toEqual({
      ok: false,
      problem: 'declined',
      reason: 'PayPal did not place the hold. Nothing was taken from your account.',
      projectId: fixture.projectId,
      milestoneId: fixture.milestoneId,
    });
    expect((await holdRows())[0].status).toBe('abandoned');
    expect(await stateNow()).toBe('signed');
  });

  it('does not undo a hold that another request activated while this one was being declined', async () => {
    const holdId = await started();
    gateway.authorizeOrder = async () => {
      await db.update(holds).set({ status: 'active', authorizationId: 'AUTH-1' }).where(eq(holds.id, holdId));
      return { declined: 'SOMETHING' };
    };
    expect(await confirm(holdId)).toMatchObject({ ok: true });
    expect((await holdRows())[0].status).toBe('active');
  });

  it('queues the cancellation for later when the refused hold cannot be cancelled at once', async () => {
    const holdId = await started();
    await db.update(milestones).set({ state: 'drafting' }).where(eq(milestones.id, fixture.milestoneId));
    gateway.failNext('voidAuthorization');
    expect(await confirm(holdId)).toMatchObject({ ok: false, problem: 'refused' });

    expect((await holdRows())[0]).toMatchObject({ status: 'invalid', authorizationId: 'AUTH-1' });
    expect(await db.select().from(paymentEvents)).toMatchObject([{ type: 'void', status: 'pending', holdId }]);
  });

  it('keeps the attempt open when PayPal cannot be reached, so reloading tries again', async () => {
    const holdId = await started();
    gateway.failNext('authorizeOrder');
    expect(await confirm(holdId)).toMatchObject({ ok: false, problem: 'unreachable' });
    expect((await holdRows())[0].status).toBe('awaiting_approval');
    expect(await confirm(holdId)).toMatchObject({ ok: true });
  });

  it('is refused for anyone but the client, and for an unknown hold', async () => {
    const holdId = await started();
    const notFound = { ok: false, problem: 'not_found', reason: 'That payment could not be found.' };
    expect(await confirm(holdId, fixture.freelancerId)).toEqual(notFound);
    expect(await confirm('3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b')).toEqual(notFound);
    expect(gateway.callsTo('authorizeOrder')).toEqual([]);
  });

  it('cancels the hold at PayPal if the milestone can no longer take it', async () => {
    const holdId = await started();
    await db.update(milestones).set({ state: 'drafting' }).where(eq(milestones.id, fixture.milestoneId));
    expect(await confirm(holdId)).toMatchObject({ ok: false, problem: 'refused' });
    expect(gateway.callsTo('voidAuthorization')).toEqual(['AUTH-1']);
    expect((await holdRows())[0].status).toBe('voided');
  });

  it('resumes a release that was waiting on new funding', async () => {
    await db
      .update(milestones)
      .set({ state: 'funding_problem', returnTo: 'releasing', releaseKind: 'full' })
      .where(eq(milestones.id, fixture.milestoneId));
    const holdId = await started();
    await confirm(holdId);

    expect(await stateNow()).toBe('releasing');
    const queued = (await db.select().from(paymentEvents)).map((row) => [row.type, row.status, row.holdId]);
    expect(queued).toEqual(expect.arrayContaining([['capture', 'pending', holdId], ['payout', 'blocked', holdId]]));
  });
});

describe('cancelFunding', () => {
  it('drops the attempt and says where to go back to', async () => {
    await start();
    const [hold] = await holdRows();
    expect(await cancelFunding(db, { holdId: hold.id, userId: fixture.clientId })).toEqual({
      projectId: fixture.projectId,
      milestoneId: fixture.milestoneId,
    });
    expect((await holdRows())[0].status).toBe('abandoned');
  });

  it('ignores anyone else, and a hold that is already active', async () => {
    await start();
    const [hold] = await holdRows();
    expect(await cancelFunding(db, { holdId: hold.id, userId: fixture.strangerId })).toBeNull();
    await confirmFunding(db, gateway, { holdId: hold.id, userId: fixture.clientId, now });
    await cancelFunding(db, { holdId: hold.id, userId: fixture.clientId });
    expect((await holdRows())[0].status).toBe('active');
  });
});
