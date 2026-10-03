import { describe, expect, it } from 'vitest';
import { setupMilestone } from '../../payments/testing';
import { milestones, paymentEvents } from '../schema';
import { createTestDb } from '../test-db';
import { timelineFacts } from './projects';

describe('timelineFacts', () => {
  it('reads when each milestone was funded and when it ended', async () => {
    const db = await createTestDb();
    const fixture = await setupMilestone(db, { state: 'released', authorizedAt: new Date('2026-10-03T12:00:00Z') });
    await db.insert(paymentEvents).values({
      milestoneId: fixture.milestoneId,
      holdId: fixture.holdId!,
      type: 'payout',
      status: 'completed',
      amountCents: 60000,
      updatedAt: new Date('2026-10-09T12:00:00Z'),
    });
    const [second] = await db
      .insert(milestones)
      .values({ projectId: fixture.projectId, position: 2, title: 'Menu page', amountCents: 40000, state: 'signed' })
      .returning({ id: milestones.id });

    const facts = await timelineFacts(db, fixture.projectId);
    expect(facts.projectStart).toBeInstanceOf(Date);
    expect(facts.milestones).toEqual([
      expect.objectContaining({ id: fixture.milestoneId, position: 1, state: 'released', fundedAt: new Date('2026-10-03T12:00:00Z'), endedAt: new Date('2026-10-09T12:00:00Z') }),
      expect.objectContaining({ id: second.id, position: 2, state: 'signed', fundedAt: null, endedAt: null }),
    ]);
  });
});
