import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { milestones, paymentEvents, settlements, submissions, verdicts, type Db } from '../db/schema';
import { createTestDb } from '../db/test-db';
import { setupVerification, type VerificationFixture } from '../verification/testing';
import { proposeSettlement, settlementChecks } from './propose';

const now = new Date('2026-10-20T12:00:00Z');
let db: Db;
let fixture: VerificationFixture;
let submissionId: string;

beforeEach(async () => {
  db = await createTestDb();
  fixture = await setupVerification(db, { state: 'settlement_proposed', attemptsUsed: 4 });
  [{ id: submissionId }] = await db
    .insert(submissions)
    .values({ milestoneId: fixture.milestoneId, attempt: 4, url: 'https://chens.example', status: 'failed' })
    .returning({ id: submissions.id });
});

type Entry = ['ai', 'pass' | 'fail' | 'unclear'] | ['client', 'approved' | 'rejected'] | null;

async function rule(entries: Entry[]) {
  for (const [index, entry] of entries.entries()) {
    if (!entry) continue;
    await db.insert(verdicts).values({ submissionId, criterionId: fixture.criteria[index].id, source: entry[0], verdict: entry[1], summary: `Summary ${index}` });
  }
}

const settlementRow = async () => (await db.select().from(settlements).where(eq(settlements.milestoneId, fixture.milestoneId)))[0];
const stateNow = async () => (await db.select().from(milestones).where(eq(milestones.id, fixture.milestoneId)))[0].state;

describe('settlementChecks', () => {
  it('reads each check with its final outcome from the last tested submission', async () => {
    await rule([['ai', 'pass'], ['ai', 'fail'], ['ai', 'unclear'], null]);
    await db.insert(verdicts).values({ submissionId, criterionId: fixture.criteria[2].id, source: 'client', verdict: 'approved', summary: 'Fine by me.' });
    await db.insert(submissions).values({ milestoneId: fixture.milestoneId, attempt: 5, url: 'https://gone.example', status: 'unreachable' });

    const result = await settlementChecks(db, fixture.milestoneId);
    expect(result.submissionId).toBe(submissionId);
    expect(result.amountCents).toBe(60000);
    expect(result.checks.map((check) => [check.shareCents, check.outcome])).toEqual([
      [20000, 'approved'],
      [15000, 'failed'],
      [15000, 'approved'],
      [10000, 'undecided'],
    ]);
  });
});

describe('proposeSettlement', () => {
  it('writes the split, a plain explanation and a deadline', async () => {
    await rule([['ai', 'pass'], ['ai', 'fail'], ['ai', 'pass'], null]);
    expect(await proposeSettlement(db, fixture.milestoneId, { now, windowSeconds: 3600 })).toBe('proposed');
    const row = await settlementRow();
    expect(row).toMatchObject({ freelancerCents: 42000, clientCents: 18000, outcome: 'pending', submissionId, dueAt: new Date('2026-10-20T13:00:00Z') });
    expect(row.explanation).toContain('2 of the 3 checks that were decided passed');
    expect(await stateNow()).toBe('settlement_proposed');
  });

  it('cancels straight away and voids the hold when no check passed', async () => {
    await rule([['ai', 'fail'], ['ai', 'fail'], ['ai', 'unclear'], null]);
    expect(await proposeSettlement(db, fixture.milestoneId, { now, windowSeconds: 3600 })).toBe('cancelled');
    expect(await settlementRow()).toMatchObject({ freelancerCents: 0, clientCents: 60000, outcome: 'cancelled', decidedAt: now });
    expect(await stateNow()).toBe('cancelled');
    expect((await db.select().from(paymentEvents)).map((row) => [row.type, row.status])).toEqual([['void', 'pending']]);
  });

  it('writes one split however many times it is asked', async () => {
    await rule([['ai', 'pass'], ['ai', 'fail'], ['ai', 'pass'], null]);
    await proposeSettlement(db, fixture.milestoneId, { now, windowSeconds: 3600 });
    expect(await proposeSettlement(db, fixture.milestoneId, { now, windowSeconds: 3600 })).toBe('skipped');
    expect(await db.select().from(settlements)).toHaveLength(1);
  });

  it('does nothing for a milestone that is not waiting for a split', async () => {
    await db.update(milestones).set({ state: 'revision' }).where(eq(milestones.id, fixture.milestoneId));
    expect(await proposeSettlement(db, fixture.milestoneId, { now, windowSeconds: 3600 })).toBe('skipped');
    expect(await db.select().from(settlements)).toHaveLength(0);
  });
});
