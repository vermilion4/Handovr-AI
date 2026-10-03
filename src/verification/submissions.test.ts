import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { milestones, submissions, type Db } from '../db/schema';
import { createTestDb } from '../db/test-db';
import { submitWork } from './submissions';
import { setupVerification, type VerificationFixture } from './testing';

const now = new Date('2026-10-12T12:00:00Z');
let db: Db;
let fixture: VerificationFixture;

beforeEach(async () => {
  db = await createTestDb();
  fixture = await setupVerification(db, { state: 'funded' });
});

const submit = (over: Partial<Parameters<typeof submitWork>[1]> = {}) =>
  submitWork(db, { milestoneId: fixture.milestoneId, userId: fixture.freelancerId, url: 'https://chens.example/contact', repoUrl: '', now, ...over });
const milestoneRow = async () => (await db.select().from(milestones).where(eq(milestones.id, fixture.milestoneId)))[0];

describe('submitWork', () => {
  it('records the submission as attempt 1 and moves the milestone to testing', async () => {
    const result = await submit({ repoUrl: 'https://github.com/rivera/chens' });
    expect(result).toMatchObject({ ok: true });
    const [row] = await db.select().from(submissions);
    expect(row).toMatchObject({ attempt: 1, url: 'https://chens.example/contact', repoUrl: 'https://github.com/rivera/chens', status: 'queued', tries: 0 });
    expect(result.ok && result.submissionId).toBe(row.id);
    expect(await milestoneRow()).toMatchObject({ state: 'verifying', submittedFrom: 'funded' });
  });

  it('numbers a resubmission after the attempts already used', async () => {
    await db.update(milestones).set({ state: 'revision', attemptsUsed: 2 }).where(eq(milestones.id, fixture.milestoneId));
    await submit();
    expect((await db.select().from(submissions))[0].attempt).toBe(3);
    expect((await milestoneRow()).submittedFrom).toBe('revision');
  });

  it('is refused for the client and for a stranger', async () => {
    for (const userId of [fixture.clientId, fixture.strangerId]) {
      expect(await submit({ userId })).toEqual({ ok: false, reason: 'Only the freelancer on this project can submit work.' });
    }
    expect(await db.select().from(submissions)).toEqual([]);
  });

  it('is refused while the milestone is not waiting for work', async () => {
    await db.update(milestones).set({ state: 'client_review' }).where(eq(milestones.id, fixture.milestoneId));
    expect(await submit()).toEqual({ ok: false, reason: 'This milestone is not waiting for work.' });
  });

  it('refuses an address the tester cannot use, and a repository link that is not https', async () => {
    expect(await submit({ url: 'http://localhost:3000' })).toMatchObject({ ok: false });
    expect(await submit({ repoUrl: 'git@github.com:rivera/chens.git' })).toEqual({
      ok: false,
      reason: 'The repository link must start with https://.',
    });
    expect((await milestoneRow()).state).toBe('funded');
  });

  it('accepts one submission when two arrive together', async () => {
    const results = await Promise.all([submit(), submit()]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await db.select().from(submissions)).toHaveLength(1);
  });
});
