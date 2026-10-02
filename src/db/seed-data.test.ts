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
});
