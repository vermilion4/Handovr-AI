import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { criteria, criteriaVersions, milestones, projects, type Db } from '../db/schema';
import { createTestDb } from '../db/test-db';
import { setupVerification, type VerificationFixture } from '../verification/testing';
import { restartMilestone } from './restart';

const now = new Date('2026-10-25T12:00:00Z');
let db: Db;
let fixture: VerificationFixture;

beforeEach(async () => {
  db = await createTestDb();
  fixture = await setupVerification(db, { state: 'cancelled', attemptsUsed: 4 });
  await db.update(projects).set({ finishedAt: new Date('2026-10-24T12:00:00Z') }).where(eq(projects.id, fixture.projectId));
});

describe('restartMilestone', () => {
  it('adds a fresh copy at the end with the same checks, waiting for both signatures', async () => {
    const result = await restartMilestone(db, { milestoneId: fixture.milestoneId, userId: fixture.clientId, now });
    if (!result.ok) throw new Error(result.reason);

    const [copy] = await db.select().from(milestones).where(eq(milestones.id, result.milestoneId));
    expect(copy).toMatchObject({
      projectId: fixture.projectId,
      position: 2,
      title: 'Contact page',
      amountCents: 60000,
      state: 'drafting',
      criteriaDraft: 'ready',
      attemptsUsed: 0,
      restartedFromId: fixture.milestoneId,
    });
    const [version] = await db.select().from(criteriaVersions).where(eq(criteriaVersions.milestoneId, copy.id));
    expect(version).toMatchObject({ version: 1, authorId: null });
    const copied = await db.select().from(criteria).where(eq(criteria.versionId, version.id)).orderBy(asc(criteria.position));
    expect(copied.map((row) => [row.description, row.shareCents])).toEqual(fixture.criteria.map((check) => [check.description, check.shareCents]));
    expect((await db.select().from(projects).where(eq(projects.id, fixture.projectId)))[0].finishedAt).toBeNull();
    expect((await db.select().from(milestones).where(eq(milestones.id, fixture.milestoneId)))[0].state).toBe('cancelled');
  });

  it('starts a lapsed milestone again too', async () => {
    await db.update(milestones).set({ state: 'lapsed' }).where(eq(milestones.id, fixture.milestoneId));
    expect((await restartMilestone(db, { milestoneId: fixture.milestoneId, userId: fixture.clientId, now })).ok).toBe(true);
  });

  it('only lets the client start again, once, from a cancelled or lapsed milestone', async () => {
    expect(await restartMilestone(db, { milestoneId: fixture.milestoneId, userId: fixture.freelancerId, now })).toEqual({
      ok: false,
      reason: 'Only the client can start a milestone again.',
    });
    await restartMilestone(db, { milestoneId: fixture.milestoneId, userId: fixture.clientId, now });
    expect(await restartMilestone(db, { milestoneId: fixture.milestoneId, userId: fixture.clientId, now })).toEqual({
      ok: false,
      reason: 'This milestone has already been started again.',
    });
    const released = await setupVerification(db, { state: 'released' });
    expect(await restartMilestone(db, { milestoneId: released.milestoneId, userId: released.clientId, now })).toEqual({
      ok: false,
      reason: 'Only a cancelled milestone or one whose hold expired can be started again.',
    });
  });
});
