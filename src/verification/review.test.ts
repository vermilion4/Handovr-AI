import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { holds, milestones, paymentEvents, submissions, verdicts, type Db } from '../db/schema';
import { createTestDb } from '../db/test-db';
import { expireReviews, submitReview } from './review';
import { setupVerification, type VerificationFixture } from './testing';

const now = new Date('2026-10-12T12:00:00Z');
let db: Db;
let fixture: VerificationFixture;
let form: string;
let look: string;

beforeEach(async () => {
  db = await createTestDb();
  fixture = await setupVerification(db, { state: 'client_review', attemptsUsed: 1 });
  await db.update(milestones).set({ reviewDueAt: new Date('2026-10-17T12:00:00Z') }).where(eq(milestones.id, fixture.milestoneId));
  const [submission] = await db
    .insert(submissions)
    .values({ milestoneId: fixture.milestoneId, attempt: 1, url: 'https://chens.example', status: 'passed' })
    .returning();
  const [formCheck, phone, speed, lookCheck] = fixture.criteria;
  await db.insert(verdicts).values([
    { submissionId: submission.id, criterionId: formCheck.id, source: 'ai', verdict: 'unclear', summary: 'Runs disagreed.' },
    { submissionId: submission.id, criterionId: phone.id, source: 'ai', verdict: 'pass', summary: '' },
    { submissionId: submission.id, criterionId: speed.id, source: 'ai', verdict: 'pass', summary: '' },
  ]);
  form = formCheck.id;
  look = lookCheck.id;
});

const review = (decisions: Record<string, 'approved' | 'rejected'>, reason = '', userId = fixture.clientId) =>
  submitReview(db, { milestoneId: fixture.milestoneId, userId, decisions, reason, now });
const milestoneNow = async () => (await db.select().from(milestones).where(eq(milestones.id, fixture.milestoneId)))[0];
const clientVerdicts = async () =>
  (await db.select().from(verdicts).where(eq(verdicts.source, 'client'))).map((row) => [row.criterionId, row.verdict, row.summary]);

describe('submitReview', () => {
  it('releases the money when the client approves every open check', async () => {
    expect(await review({ [form]: 'approved', [look]: 'approved' })).toEqual({ ok: true, released: true });
    expect(await milestoneNow()).toMatchObject({ state: 'releasing', reviewDueAt: null });
    expect(await clientVerdicts()).toEqual(
      expect.arrayContaining([[form, 'approved', 'Approved by the client.'], [look, 'approved', 'Approved by the client.']]),
    );
    expect((await db.select().from(paymentEvents)).map((row) => row.type)).toEqual(['capture', 'payout']);
  });

  it('sends the work back with the reason when any check is rejected', async () => {
    expect(await review({ [form]: 'approved', [look]: 'rejected' }, 'The header does not match the homepage colours.')).toEqual({ ok: true, released: false });
    expect(await milestoneNow()).toMatchObject({ state: 'revision', attemptsUsed: 1 });
    expect(await clientVerdicts()).toEqual(expect.arrayContaining([[look, 'rejected', 'The header does not match the homepage colours.']]));
  });

  it('needs a reason to send the work back', async () => {
    expect(await review({ [form]: 'approved', [look]: 'rejected' }, 'no')).toEqual({ ok: false, reason: 'Say what needs to change, in a sentence or two.' });
    expect((await milestoneNow()).state).toBe('client_review');
  });

  it('needs a decision on every open check', async () => {
    expect(await review({ [look]: 'approved' })).toEqual({ ok: false, reason: 'Decide every check marked as yours before sending the review.' });
    expect(await clientVerdicts()).toEqual([]);
  });

  it('is refused for the freelancer and a stranger, and when nothing is waiting for review', async () => {
    for (const userId of [fixture.freelancerId, fixture.strangerId]) {
      expect(await review({ [form]: 'approved', [look]: 'approved' }, '', userId)).toEqual({ ok: false, reason: 'Only the client on this project can review it.' });
    }
    await review({ [form]: 'approved', [look]: 'approved' });
    expect(await review({ [form]: 'approved', [look]: 'approved' })).toEqual({ ok: false, reason: 'This milestone is not waiting for your review.' });
  });
});

describe('expireReviews', () => {
  it('leaves a review alone until its window ends', async () => {
    expect(await expireReviews(db, new Date('2026-10-17T11:59:59Z'))).toBe(0);
    expect((await milestoneNow()).state).toBe('client_review');
  });

  it('approves every open check and releases when the window ends, once', async () => {
    expect(await expireReviews(db, new Date('2026-10-17T12:00:00Z'))).toBe(1);
    expect(await milestoneNow()).toMatchObject({ state: 'releasing', reviewDueAt: null });
    expect(await clientVerdicts()).toEqual(
      expect.arrayContaining([
        [form, 'approved', 'Approved automatically when the review window ended.'],
        [look, 'approved', 'Approved automatically when the review window ended.'],
      ]),
    );
    expect(await expireReviews(db, new Date('2026-10-18T12:00:00Z'))).toBe(0);
    expect(
      await db.select().from(paymentEvents).where(and(eq(paymentEvents.milestoneId, fixture.milestoneId), eq(paymentEvents.type, 'capture'))),
    ).toHaveLength(1);
  });

  it('records nothing when the release cannot go ahead', async () => {
    await db.update(holds).set({ status: 'expired' });
    expect(await expireReviews(db, new Date('2026-10-17T12:00:00Z'))).toBe(0);
    expect(await clientVerdicts()).toEqual([]);
    expect((await milestoneNow()).state).toBe('client_review');
  });
});
