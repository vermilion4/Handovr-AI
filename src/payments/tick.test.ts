import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { holds, milestones, paymentEvents, type Db } from '../db/schema';
import { createTestDb } from '../db/test-db';
import { GatewayError } from './gateway';
import { applyEvent } from './milestone-events';
import { fakeGateway, setupMilestone, type FakeGateway } from './testing';
import { runTick, validTickKey } from './tick';

const authorizedAt = new Date('2026-10-01T12:00:00Z');
const day = (n: number) => new Date(authorizedAt.getTime() + n * 24 * 60 * 60 * 1000);

let db: Db;
let gateway: FakeGateway;

beforeEach(async () => {
  db = await createTestDb();
  gateway = fakeGateway();
});

const holdRow = async (id: string) => (await db.select().from(holds).where(eq(holds.id, id)))[0];
const stateOf = async (id: string) => (await db.select().from(milestones).where(eq(milestones.id, id)))[0].state;
const eventsOf = async (milestoneId: string) =>
  (await db.select().from(paymentEvents).where(eq(paymentEvents.milestoneId, milestoneId))).map((row) => [row.type, row.status]);

describe('runTick: holds over time', () => {
  it('leaves a young hold alone', async () => {
    const { holdId } = await setupMilestone(db, { state: 'funded', authorizedAt });
    expect(await runTick(db, gateway, day(10))).toEqual({ renewed: 0, expired: 0, errors: [] });
    expect(gateway.calls).toEqual([]);
    expect((await holdRow(holdId!)).renewedAt).toBeNull();
  });

  it('renews a hold once on day 25 and records it', async () => {
    const { holdId, milestoneId } = await setupMilestone(db, { state: 'funded', authorizedAt });
    expect(await runTick(db, gateway, day(25))).toMatchObject({ renewed: 1 });

    const hold = await holdRow(holdId!);
    expect(hold).toMatchObject({ authorizationId: 'AUTH-0-R', renewedAt: day(25), expiresAt: new Date('2026-11-24T12:00:00Z'), status: 'active' });
    expect(gateway.callsTo('reauthorize')).toMatchObject([{ authorizationId: 'AUTH-0', totalCents: 61823 }]);
    expect(await eventsOf(milestoneId)).toEqual([['renew', 'completed']]);

    expect(await runTick(db, gateway, day(26))).toMatchObject({ renewed: 0 });
    expect(gateway.callsTo('reauthorize')).toHaveLength(1);
  });

  it('gives up renewing when PayPal refuses, and lets the hold run to its expiry', async () => {
    const { holdId, milestoneId } = await setupMilestone(db, { state: 'funded', authorizedAt });
    gateway.failNext('reauthorize', new GatewayError('declined', 422, 'REAUTHORIZATION_NOT_SUPPORTED'));
    await runTick(db, gateway, day(25));
    expect(await eventsOf(milestoneId)).toEqual([['renew', 'failed']]);
    expect((await holdRow(holdId!)).renewedAt).toEqual(day(25));

    await runTick(db, gateway, day(26));
    expect(gateway.callsTo('reauthorize')).toHaveLength(1);
  });

  it('tries the renewal again on the next tick when PayPal could not be reached', async () => {
    const { holdId } = await setupMilestone(db, { state: 'funded', authorizedAt });
    gateway.failNext('reauthorize');
    await runTick(db, gateway, day(25));
    expect((await holdRow(holdId!)).renewedAt).toBeNull();
    expect(await runTick(db, gateway, day(25.1))).toMatchObject({ renewed: 1 });
    const requestIds = (gateway.callsTo('reauthorize') as Array<{ requestId: string }>).map((call) => call.requestId);
    expect(requestIds).toHaveLength(2);
    expect(new Set(requestIds).size).toBe(1);
  });

  it('lapses the milestone when its hold expires', async () => {
    const { holdId, milestoneId } = await setupMilestone(db, { state: 'revision', authorizedAt });
    expect(await runTick(db, gateway, day(29))).toMatchObject({ expired: 1 });
    expect((await holdRow(holdId!)).status).toBe('expired');
    expect(await stateOf(milestoneId)).toBe('lapsed');
  });

  it('does not lapse a milestone that is already being released', async () => {
    const { milestoneId } = await setupMilestone(db, { state: 'client_review', authorizedAt });
    await applyEvent(db, milestoneId, { type: 'client_approved' }, { now: day(28) });
    gateway.failNext('capture');
    gateway.failNext('capture');
    await runTick(db, gateway, day(29));
    expect(await stateOf(milestoneId)).toBe('releasing');
  });

  it('never calls PayPal for a simulated hold', async () => {
    await setupMilestone(db, { state: 'funded', authorizedAt, simulated: true });
    expect(await runTick(db, gateway, day(40))).toEqual({ renewed: 0, expired: 0, errors: [] });
    expect(gateway.calls).toEqual([]);
  });
});

describe('runTick: unfinished payments', () => {
  it('sends queued work, confirms the payout and releases the milestone across ticks', async () => {
    const { milestoneId } = await setupMilestone(db, { state: 'client_review', authorizedAt });
    await applyEvent(db, milestoneId, { type: 'client_approved' }, { now: day(3) });

    await runTick(db, gateway, day(3));
    expect(await stateOf(milestoneId)).toBe('releasing');

    gateway.payoutState = { status: 'success', detail: '' };
    await runTick(db, gateway, day(3.01));
    expect(await stateOf(milestoneId)).toBe('released');
  });

  it('carries on with the other steps when one step throws', async () => {
    const { holdId } = await setupMilestone(db, { state: 'funded', authorizedAt });
    gateway.failNext('reauthorize', new Error('unexpected'));
    const report = await runTick(db, gateway, day(25));
    expect(report.errors).toHaveLength(1);
    expect((await holdRow(holdId!)).status).toBe('active');
  });
});

describe('validTickKey', () => {
  it('accepts only the configured secret', () => {
    expect(validTickKey('s3cret-value', 's3cret-value')).toBe(true);
    expect(validTickKey('wrong', 's3cret-value')).toBe(false);
    expect(validTickKey(null, 's3cret-value')).toBe(false);
    expect(validTickKey('', '')).toBe(false);
    expect(validTickKey('anything', undefined)).toBe(false);
  });
});
