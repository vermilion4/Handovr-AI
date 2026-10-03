import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { milestones, paymentEvents, settlements, type Db } from '../db/schema';
import { createTestDb } from '../db/test-db';
import { recordingNotice } from '../notifications/notice';
import { setupVerification, type VerificationFixture } from '../verification/testing';
import { expireSettlements, respondToSettlement } from './respond';

const now = new Date('2026-10-20T12:00:00Z');
let db: Db;
let fixture: VerificationFixture;

beforeEach(async () => {
  db = await createTestDb();
  fixture = await setupVerification(db, { state: 'settlement_proposed', attemptsUsed: 4 });
  await db.insert(settlements).values({
    milestoneId: fixture.milestoneId,
    freelancerCents: 48000,
    clientCents: 12000,
    explanation: 'Three of four checks passed.',
    dueAt: new Date('2026-10-21T12:00:00Z'),
    createdAt: now,
  });
});

const respond = (userId: string, response: 'accepted' | 'declined', at = now) =>
  respondToSettlement(db, { milestoneId: fixture.milestoneId, userId, response, now: at });
const settlementNow = async () => (await db.select().from(settlements))[0];
const stateNow = async () => (await db.select().from(milestones).where(eq(milestones.id, fixture.milestoneId)))[0].state;
const money = async () => (await db.select().from(paymentEvents)).map((row) => [row.type, row.status, row.amountCents]);

describe('respondToSettlement', () => {
  it('waits for the second person after the first accepts', async () => {
    expect(await respond(fixture.freelancerId, 'accepted')).toEqual({ ok: true, outcome: 'waiting' });
    expect(await settlementNow()).toMatchObject({ freelancerResponse: 'accepted', clientResponse: null, outcome: 'pending' });
    expect(await stateNow()).toBe('settlement_proposed');
    expect(await money()).toEqual([]);
  });

  it("captures and pays the freelancer's share once both accept", async () => {
    await respond(fixture.freelancerId, 'accepted');
    expect(await respond(fixture.clientId, 'accepted')).toEqual({ ok: true, outcome: 'accepted' });
    expect(await settlementNow()).toMatchObject({ outcome: 'accepted', decidedAt: now });
    expect(await stateNow()).toBe('releasing');
    expect(await money()).toEqual([
      ['capture', 'pending', 49464],
      ['payout', 'blocked', 48000],
    ]);
  });

  it('returns the hold when either person declines, even after the other accepted', async () => {
    await respond(fixture.freelancerId, 'accepted');
    expect(await respond(fixture.clientId, 'declined')).toEqual({ ok: true, outcome: 'declined' });
    expect(await settlementNow()).toMatchObject({ outcome: 'declined', clientResponse: 'declined' });
    expect(await stateNow()).toBe('cancelled');
    expect(await money()).toEqual([['void', 'pending', expect.any(Number)]]);
  });

  it('refuses a second answer, a stranger and an answer after the deadline', async () => {
    await respond(fixture.clientId, 'accepted');
    expect(await respond(fixture.clientId, 'declined')).toEqual({ ok: false, reason: 'You have already answered this split.' });
    expect(await respond(fixture.strangerId, 'accepted')).toEqual({ ok: false, reason: 'Only the client and the freelancer on this project can answer.' });
    expect(await respond(fixture.freelancerId, 'accepted', new Date('2026-10-21T12:00:01Z'))).toEqual({
      ok: false,
      reason: 'The time to answer this split has ended.',
    });
  });

  it('refuses once the split is decided', async () => {
    await respond(fixture.clientId, 'declined');
    expect(await respond(fixture.freelancerId, 'accepted')).toEqual({ ok: false, reason: 'This split has already been decided.' });
  });

  it('pays out once when both accept at the same moment', async () => {
    const results = await Promise.all([respond(fixture.freelancerId, 'accepted'), respond(fixture.clientId, 'accepted')]);
    expect(results.map((result) => result.ok && result.outcome).sort()).toEqual(['accepted', 'waiting']);
    expect((await money()).filter(([type]) => type === 'payout')).toHaveLength(1);
  });
});

describe('expireSettlements', () => {
  it('returns the hold when the deadline passes without both acceptances', async () => {
    await respond(fixture.freelancerId, 'accepted');
    expect(await expireSettlements(db, new Date('2026-10-21T11:59:59Z'))).toBe(0);
    expect(await expireSettlements(db, new Date('2026-10-21T12:00:00Z'))).toBe(1);
    expect(await settlementNow()).toMatchObject({ outcome: 'timed_out' });
    expect(await stateNow()).toBe('cancelled');
    expect(await expireSettlements(db, new Date('2026-10-22T12:00:00Z'))).toBe(0);
  });

  it('tells both people when a split runs out of time', async () => {
    const notice = recordingNotice();
    await expireSettlements(db, new Date('2026-10-21T12:00:00Z'), notice);
    expect(notice.told).toEqual([['cancelled', fixture.milestoneId]]);
  });
});
