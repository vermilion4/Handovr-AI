import { beforeEach, describe, expect, it } from 'vitest';
import { setupVerification, type VerificationFixture } from '../../verification/testing';
import { evidence, submissions, verdicts, type Db } from '../schema';
import { createTestDb } from '../test-db';
import { getMilestoneView } from './milestone-view';

let db: Db;
let fixture: VerificationFixture;

beforeEach(async () => {
  db = await createTestDb();
  fixture = await setupVerification(db, { state: 'client_review', attemptsUsed: 2 });
});

describe('getMilestoneView', () => {
  it('returns the milestone, its signed checks and the latest submission with its verdicts and evidence', async () => {
    await db.insert(submissions).values({ milestoneId: fixture.milestoneId, attempt: 1, url: 'https://old.example', status: 'failed', createdAt: new Date('2026-10-10') });
    const [latest] = await db
      .insert(submissions)
      .values({ milestoneId: fixture.milestoneId, attempt: 2, url: 'https://new.example', status: 'passed', createdAt: new Date('2026-10-11') })
      .returning();
    const [verdict] = await db
      .insert(verdicts)
      .values({ submissionId: latest.id, criterionId: fixture.criteria[0].id, source: 'ai', verdict: 'pass', summary: 'Sent.' })
      .returning();
    await db.insert(evidence).values([
      { submissionId: latest.id, verdictId: verdict.id, kind: 'screenshot', caption: 'After pressing Send', image: new Uint8Array([1, 2]) },
      { submissionId: latest.id, kind: 'note', caption: 'Opened', text: 'HTTP 200' },
    ]);

    const view = (await getMilestoneView(db, fixture.projectId, fixture.milestoneId, fixture.clientId))!;
    expect(view.viewerRole).toBe('client');
    expect(view.milestone).toMatchObject({ title: 'Contact page', amountCents: 60000, state: 'client_review', attemptsUsed: 2 });
    expect(view.criteria.map((check) => check.description)).toEqual(fixture.criteria.map((check) => check.description));
    expect(view.submission).toMatchObject({ attempt: 2, url: 'https://new.example', status: 'passed' });
    expect(view.verdicts).toEqual([{ id: verdict.id, criterionId: fixture.criteria[0].id, source: 'ai', verdict: 'pass', summary: 'Sent.' }]);
    expect(view.evidence.map((item) => [item.kind, item.hasImage, item.verdictId])).toEqual(
      expect.arrayContaining([['screenshot', true, verdict.id], ['note', false, null]]),
    );
  });

  it('works for the freelancer and answers nothing to a stranger or a milestone of another project', async () => {
    expect((await getMilestoneView(db, fixture.projectId, fixture.milestoneId, fixture.freelancerId))!.viewerRole).toBe('freelancer');
    expect(await getMilestoneView(db, fixture.projectId, fixture.milestoneId, fixture.strangerId)).toBeNull();
    const other = await setupVerification(db, { state: 'funded' });
    expect(await getMilestoneView(db, fixture.projectId, other.milestoneId, fixture.clientId)).toBeNull();
  });

  it('has no submission before work is submitted', async () => {
    expect((await getMilestoneView(db, fixture.projectId, fixture.milestoneId, fixture.clientId))!.submission).toBeNull();
  });

  it('keeps showing the last tested results after a resubmission the tester could not open', async () => {
    const [failed] = await db
      .insert(submissions)
      .values({ milestoneId: fixture.milestoneId, attempt: 1, url: 'https://ok.example', status: 'failed', createdAt: new Date('2026-10-10') })
      .returning();
    await db.insert(verdicts).values({ submissionId: failed.id, criterionId: fixture.criteria[0].id, source: 'ai', verdict: 'fail', summary: 'Send did nothing.' });
    await db.insert(submissions).values({ milestoneId: fixture.milestoneId, attempt: 2, url: 'https://typo.example', status: 'unreachable', createdAt: new Date('2026-10-11') });

    const view = (await getMilestoneView(db, fixture.projectId, fixture.milestoneId, fixture.freelancerId))!;
    expect(view.submission).toMatchObject({ status: 'unreachable', url: 'https://typo.example' });
    expect(view.verdicts.map((verdict) => verdict.summary)).toEqual(['Send did nothing.']);
  });
});
