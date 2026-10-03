import { beforeEach, describe, expect, it } from 'vitest';
import { setupMilestone, type MilestoneFixture } from '../../payments/testing';
import { notifications, type Db } from '../schema';
import { createTestDb } from '../test-db';
import { recentActivity } from './projects';

let db: Db;
let fixture: MilestoneFixture;

beforeEach(async () => {
  db = await createTestDb();
  fixture = await setupMilestone(db, { state: 'funded' });
});

const row = (userId: string, subject: string, at: string) => ({
  userId,
  milestoneId: fixture.milestoneId,
  kind: 'funded',
  subject,
  body: '',
  status: 'logged' as const,
  createdAt: new Date(at),
});

describe('recentActivity', () => {
  it("lists the viewer's notifications for the project, newest first", async () => {
    await db.insert(notifications).values([
      row(fixture.clientId, 'Contact page is signed by both of you', '2026-10-02T12:00:00Z'),
      row(fixture.freelancerId, 'Contact page is funded', '2026-10-03T12:00:00Z'),
      row(fixture.clientId, '$600.00 is held for Contact page', '2026-10-03T12:00:00Z'),
    ]);
    const other = await setupMilestone(db, { state: 'funded' });
    await db.insert(notifications).values({ ...row(other.clientId, 'Elsewhere', '2026-10-04T12:00:00Z'), milestoneId: other.milestoneId });

    expect((await recentActivity(db, fixture.projectId, fixture.clientId)).map((item) => item.subject)).toEqual([
      '$600.00 is held for Contact page',
      'Contact page is signed by both of you',
    ]);
  });

  it('shows at most eight', async () => {
    await db.insert(notifications).values(Array.from({ length: 10 }, (_, i) => row(fixture.clientId, `Note ${i}`, `2026-10-${String(10 + i)}T12:00:00Z`)));
    const items = await recentActivity(db, fixture.projectId, fixture.clientId);
    expect(items).toHaveLength(8);
    expect(items[0].subject).toBe('Note 9');
  });
});
