import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { milestones, paymentEvents, projects, type Db } from '../db/schema';
import { createTestDb } from '../db/test-db';
import { applyEvent } from './milestone-events';
import { setupMilestone } from './testing';

const now = new Date('2026-10-10T12:00:00Z');
let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

const queued = async (milestoneId: string) =>
  (await db.select().from(paymentEvents).where(eq(paymentEvents.milestoneId, milestoneId)).orderBy(asc(paymentEvents.createdAt))).map(
    (row) => [row.type, row.status, row.amountCents],
  );
const milestoneRow = async (id: string) => (await db.select().from(milestones).where(eq(milestones.id, id)))[0];

describe('applyEvent', () => {
  it('moves the milestone and stores the whole state machine context', async () => {
    const { milestoneId } = await setupMilestone(db, { state: 'funded' });
    expect(await applyEvent(db, milestoneId, { type: 'work_submitted' }, { now })).toEqual({ ok: true, state: 'verifying' });
    expect(await milestoneRow(milestoneId)).toMatchObject({ state: 'verifying', submittedFrom: 'funded' });
    expect(await queued(milestoneId)).toEqual([]);
  });

  it('refuses an event the state does not allow and changes nothing', async () => {
    const { milestoneId } = await setupMilestone(db, { state: 'funded' });
    const result = await applyEvent(db, milestoneId, { type: 'payout_confirmed' }, { now });
    expect(result).toEqual({ ok: false, reason: 'Event "payout_confirmed" is not allowed in state "funded"' });
    expect((await milestoneRow(milestoneId)).state).toBe('funded');
  });

  it('queues a capture of the whole hold and a payout of the milestone amount on a full release', async () => {
    const { milestoneId } = await setupMilestone(db, { state: 'client_review' });
    expect(await applyEvent(db, milestoneId, { type: 'client_approved' }, { now })).toEqual({ ok: true, state: 'releasing' });
    expect(await queued(milestoneId)).toEqual([
      ['capture', 'pending', 61823],
      ['payout', 'blocked', 60000],
    ]);
    expect((await milestoneRow(milestoneId)).releaseKind).toBe('full');
  });

  it("queues a capture of the freelancer's share plus its fee on a split", async () => {
    const { milestoneId } = await setupMilestone(db, { state: 'settlement_proposed' });
    await applyEvent(db, milestoneId, { type: 'settlement_accepted' }, { now, splitFreelancerCents: 36000 });
    expect(await queued(milestoneId)).toEqual([
      ['capture', 'pending', 37106],
      ['payout', 'blocked', 36000],
    ]);
    expect(await milestoneRow(milestoneId)).toMatchObject({ state: 'releasing', releaseKind: 'split', splitFreelancerCents: 36000 });
  });

  it('refuses a split with no amount, a zero amount or more than the milestone', async () => {
    for (const split of [undefined, 0, 60001]) {
      const { milestoneId } = await setupMilestone(db, { state: 'settlement_proposed' });
      const result = await applyEvent(db, milestoneId, { type: 'settlement_accepted' }, { now, splitFreelancerCents: split });
      expect(result).toEqual({ ok: false, reason: 'The split must be between one cent and the milestone amount.' });
      expect((await milestoneRow(milestoneId)).state).toBe('settlement_proposed');
      expect(await queued(milestoneId)).toEqual([]);
    }
  });

  it('queues a void when a split is declined', async () => {
    const { milestoneId } = await setupMilestone(db, { state: 'settlement_proposed' });
    expect(await applyEvent(db, milestoneId, { type: 'settlement_declined' }, { now })).toEqual({ ok: true, state: 'cancelled' });
    expect(await queued(milestoneId)).toEqual([['void', 'pending', 61823]]);
  });

  it('refuses a money movement when there is no active hold', async () => {
    const { milestoneId } = await setupMilestone(db, { state: 'client_review', hold: 'expired' });
    expect(await applyEvent(db, milestoneId, { type: 'client_approved' }, { now })).toEqual({
      ok: false,
      reason: 'There is no active hold for this milestone.',
    });
    expect((await milestoneRow(milestoneId)).state).toBe('client_review');
  });

  it('queues the release again when a funding problem during release is fixed', async () => {
    const { milestoneId } = await setupMilestone(db, {
      state: 'funding_problem',
      milestone: { returnTo: 'releasing', releaseKind: 'split', splitFreelancerCents: 36000 },
    });
    expect(await applyEvent(db, milestoneId, { type: 'hold_confirmed' }, { now })).toEqual({ ok: true, state: 'releasing' });
    expect(await queued(milestoneId)).toEqual([
      ['capture', 'pending', 37106],
      ['payout', 'blocked', 36000],
    ]);
    expect((await milestoneRow(milestoneId)).returnTo).toBeNull();
  });

  it('marks the project finished when its last milestone ends', async () => {
    const { milestoneId, projectId } = await setupMilestone(db, {
      state: 'releasing',
      milestone: { releaseKind: 'full' },
    });
    await applyEvent(db, milestoneId, { type: 'payout_confirmed' }, { now });
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(project.finishedAt).toEqual(now);
    expect(await milestoneRow(milestoneId)).toMatchObject({ state: 'released', releaseKind: null });
  });

  it('leaves the project open while another milestone is unfinished', async () => {
    const { milestoneId, projectId } = await setupMilestone(db, { state: 'releasing', milestone: { releaseKind: 'full' } });
    await db.insert(milestones).values({ projectId, position: 2, title: 'Next', amountCents: 10000, state: 'drafting' });
    await applyEvent(db, milestoneId, { type: 'payout_confirmed' }, { now });
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(project.finishedAt).toBeNull();
  });

  it('answers a milestone that does not exist', async () => {
    expect(await applyEvent(db, '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b', { type: 'work_submitted' }, { now })).toEqual({
      ok: false,
      reason: 'That milestone does not exist.',
    });
  });
});
