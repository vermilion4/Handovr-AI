import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { milestones, notifications, type Db } from '../db/schema';
import { createTestDb } from '../db/test-db';
import { setupMilestone, type MilestoneFixture } from '../payments/testing';
import { logMailer, notify, type Mailer } from './notify';

const now = new Date('2026-10-20T12:00:00Z');
const appUrl = 'https://handovr.example';
let db: Db;
let fixture: MilestoneFixture;

beforeEach(async () => {
  db = await createTestDb();
  fixture = await setupMilestone(db, { state: 'funded' });
});

afterEach(() => {
  delete process.env.NOTIFY_INBOX;
});

const recording = (fail = false): Mailer & { sent: Array<{ to: string; subject: string; body: string }> } => {
  const sent: Array<{ to: string; subject: string; body: string }> = [];
  return {
    sent,
    async send(message) {
      if (fail) throw new Error('Zapier is down');
      sent.push(message);
    },
  };
};

describe('notify', () => {
  it('sends to each person named and records it', async () => {
    const mailer = recording();
    await notify(db, mailer, { kind: 'funded', milestoneId: fixture.milestoneId, to: 'both', now, appUrl });
    expect(mailer.sent.map((message) => message.to.split('-')[0])).toEqual(['maya', 'tomás']);
    expect(mailer.sent[0].body).toContain(`https://handovr.example/projects/${fixture.projectId}/milestones/${fixture.milestoneId}`);
    expect((await db.select().from(notifications)).map((row) => row.status)).toEqual(['sent', 'sent']);
  });

  it('sends to the demo inbox when one is set, naming the intended person', async () => {
    const mailer = recording();
    process.env.NOTIFY_INBOX = 'demo@inbox.example';
    await notify(db, mailer, { kind: 'review_needed', milestoneId: fixture.milestoneId, to: 'client', now, appUrl });
    expect(mailer.sent[0].to).toBe('demo@inbox.example');
    expect(mailer.sent[0].body.startsWith('For Maya Chen')).toBe(true);
  });

  it("names the freelancer's share once a split has been paid", async () => {
    await db.update(milestones).set({ state: 'released', releaseKind: null, splitFreelancerCents: 48000 }).where(eq(milestones.id, fixture.milestoneId));
    const mailer = recording();
    await notify(db, mailer, { kind: 'paid', milestoneId: fixture.milestoneId, to: 'freelancer', now, appUrl });
    expect(mailer.sent[0].subject).toBe('You were paid $480.00 for Contact page');
  });

  it('records a failure without throwing', async () => {
    await expect(notify(db, recording(true), { kind: 'paid', milestoneId: fixture.milestoneId, to: 'freelancer', now, appUrl })).resolves.toBeUndefined();
    expect(await db.select().from(notifications)).toMatchObject([{ status: 'failed', detail: 'Zapier is down' }]);
  });

  it('marks mail that only went to the log', async () => {
    await notify(db, logMailer, { kind: 'cancelled', milestoneId: fixture.milestoneId, to: 'client', now, appUrl });
    expect(await db.select().from(notifications)).toMatchObject([{ status: 'logged' }]);
  });

  it('does not throw for a milestone that does not exist', async () => {
    await expect(notify(db, recording(), { kind: 'paid', milestoneId: crypto.randomUUID(), to: 'both', now, appUrl })).resolves.toBeUndefined();
  });
});
