import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { milestones, submissions, type Db } from '../db/schema';
import { createTestDb } from '../db/test-db';
import { verificationsToRun } from './restart';
import { setupVerification, type VerificationFixture } from './testing';

const now = new Date('2026-10-12T12:00:00Z');
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
let db: Db;
let fixture: VerificationFixture;

beforeEach(async () => {
  db = await createTestDb();
  fixture = await setupVerification(db, { state: 'verifying' });
});

const add = async (values: Partial<typeof submissions.$inferInsert>) =>
  (await db.insert(submissions).values({ milestoneId: fixture.milestoneId, attempt: 1, url: 'https://chens.example', ...values }).returning())[0];

describe('verificationsToRun', () => {
  it('leaves a brand new submission to the run that was just started for it', async () => {
    await add({ status: 'queued', createdAt: ago(0.5) });
    expect(await verificationsToRun(db, now)).toEqual([]);
  });

  it('picks up a queued submission whose run never started', async () => {
    const row = await add({ status: 'queued', createdAt: ago(2) });
    expect(await verificationsToRun(db, now)).toEqual([row.id]);
  });

  it('queues a run that has gone quiet for over 20 minutes, and leaves a recent one alone', async () => {
    const stuck = await add({ status: 'running', createdAt: ago(30), startedAt: ago(21) });
    await add({ status: 'running', createdAt: ago(30), startedAt: ago(5) });
    expect(await verificationsToRun(db, now)).toEqual([stuck.id]);
    expect((await db.select().from(submissions).where(eq(submissions.id, stuck.id)))[0].status).toBe('queued');
  });

  it('never picks a simulated submission', async () => {
    await add({ status: 'queued', createdAt: ago(10), simulated: true });
    await add({ status: 'running', createdAt: ago(60), startedAt: ago(50), simulated: true });
    expect(await verificationsToRun(db, now)).toEqual([]);
  });

  it('does not requeue a long run that is still working', async () => {
    await add({ status: 'running', createdAt: ago(40), startedAt: ago(30), heartbeatAt: ago(1) });
    expect(await verificationsToRun(db, now)).toEqual([]);
  });

  it('leaves a queued run alone while its milestone is not being tested', async () => {
    await db.update(milestones).set({ state: 'funding_problem', returnTo: 'verifying' }).where(eq(milestones.id, fixture.milestoneId));
    await add({ status: 'queued', createdAt: ago(10) });
    expect(await verificationsToRun(db, now)).toEqual([]);
  });
});
