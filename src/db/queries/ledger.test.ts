import { beforeEach, describe, expect, it } from 'vitest';
import { applyEvent } from '../../payments/milestone-events';
import { processPayments } from '../../payments/processor';
import { fakeGateway, setupMilestone, type MilestoneFixture } from '../../payments/testing';
import type { Db } from '../schema';
import { createTestDb } from '../test-db';
import { listLedger } from './ledger';

const now = new Date('2026-10-10T12:00:00Z');
let db: Db;
let fixture: MilestoneFixture;

beforeEach(async () => {
  db = await createTestDb();
  fixture = await setupMilestone(db, { state: 'client_review' });
  await applyEvent(db, fixture.milestoneId, { type: 'client_approved' }, { now });
  await processPayments(db, fakeGateway(), now);
});

describe('listLedger', () => {
  it('returns the money events of the projects the person is on, with names and the other person', async () => {
    const ledger = await listLedger(db, fixture.clientId);
    expect(ledger.role).toBe('client');
    expect(ledger.events.map((e) => [e.type, e.status, e.amountCents, e.holdAmountCents])).toEqual(
      expect.arrayContaining([
        ['capture', 'completed', 61823, 60000],
        ['payout', 'sent', 60000, 60000],
      ]),
    );
    expect(ledger.events[0]).toMatchObject({
      projectTitle: "Chen's Bakery website",
      milestoneTitle: 'Contact page',
      counterpartName: 'Tomás Rivera',
    });
    expect(ledger.activeHolds).toEqual([]);
  });

  it("gives the freelancer the same events with the client as the other person", async () => {
    const ledger = await listLedger(db, fixture.freelancerId);
    expect(ledger.role).toBe('freelancer');
    expect(ledger.events).toHaveLength(2);
    expect(ledger.events[0].counterpartName).toBe('Maya Chen');
  });

  it('shows nothing to someone who is not on the project', async () => {
    const ledger = await listLedger(db, fixture.strangerId);
    expect(ledger.events).toEqual([]);
    expect(ledger.activeHolds).toEqual([]);
  });

  it('lists holds that are active now', async () => {
    const other = await setupMilestone(db, { state: 'funded' });
    expect((await listLedger(db, other.clientId)).activeHolds).toEqual([{ amountCents: 60000, totalCents: 61823 }]);
  });
});
