import { eq } from 'drizzle-orm';
import { holdTotalCents } from '../domain/hold';
import { ledgerRows, ledgerTotals } from '../domain/ledger';
import { listLedger } from './queries/ledger';
import { holds } from './schema';
import { beforeAll, describe, expect, it } from 'vitest';
import { contractStatus } from '../domain/contract';
import { checkCriteriaList } from '../domain/criteria';
import { getContract } from './queries/contract';
import { listProjectsForUser } from './queries/projects';
import type { Db } from './schema';
import { seedDemo } from './seed-data';
import { createTestDb } from './test-db';

let db: Db;
let people: { mayaId: string; tomasId: string; lonelyId: string };

beforeAll(async () => {
  db = await createTestDb();
  people = await seedDemo(db);
});

async function contractOf(title: string) {
  const project = (await listProjectsForUser(db, people.mayaId)).find((p) => p.title === title)!;
  return (await getContract(db, project.id, people.mayaId))!;
}

describe('seedDemo', () => {
  it('gives every drafted milestone a list whose shares total its amount', async () => {
    for (const project of await listProjectsForUser(db, people.mayaId)) {
      const contract = (await getContract(db, project.id, people.mayaId))!;
      for (const milestone of contract.milestones) {
        if (milestone.criteriaDraft !== 'ready') {
          expect(milestone.version).toBeNull();
          continue;
        }
        expect(checkCriteriaList(milestone.amountCents, milestone.version!.criteria)).toBeNull();
      }
    }
  });

  it('records both signatures on milestones that are past drafting', async () => {
    const bakery = await contractOf("Chen's Bakery website");
    expect(bakery.milestones.map((m) => m.version!.signedBy.length)).toEqual([2, 2, 0]);
  });

  it("shows Maya a change from Tomás that she has not accepted", async () => {
    const portal = await contractOf('Wholesale order portal');
    const [login, history] = portal.milestones;
    expect(contractStatus(login, people.mayaId)).toBe('changes_suggested');
    expect(contractStatus(login, people.tomasId)).toBe('ready_to_sign');
    expect(login.version).toMatchObject({ number: 2, authorId: people.tomasId });
    expect(login.version!.reason).not.toBe('');
    expect(login.version!.criteria).toHaveLength(6);
    expect(contractStatus(history, people.mayaId)).toBe('ready_to_sign');
  });

  it('gives funded and released milestones simulated holds and a money history', async () => {
    const all = await db.select().from(holds);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((hold) => hold.simulated)).toBe(true);
    expect(await db.select().from(holds).where(eq(holds.status, 'awaiting_approval'))).toEqual([]);

    const ledger = await listLedger(db, people.mayaId);
    expect(ledgerTotals(ledger.events, ledger.activeHolds, 'client')).toEqual({
      heldCents: holdTotalCents(60000) + holdTotalCents(45000),
      releasedCents: 90000 + 40000,
      returnedCents: 0,
    });
    const bakeryHome = ledgerRows(ledger.events, 'client').filter((row) => row.milestone === 'Homepage');
    expect(bakeryHome.map((row) => row.label)).toEqual(['Paid out to Tomás', 'Payment captured', 'Hold placed']);
  });

  it("shows Tomás what is held for him and what he has been paid", async () => {
    const ledger = await listLedger(db, people.tomasId);
    expect(ledgerTotals(ledger.events, ledger.activeHolds, 'freelancer')).toEqual({
      heldCents: 60000 + 80000,
      releasedCents: 90000 + 50000 + 70000 + 70000 + 80000,
      returnedCents: 0,
    });
  });
});
