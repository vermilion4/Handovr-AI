import { beforeAll, describe, expect, it } from 'vitest';
import { seedDemo } from '../seed-data';
import type { Db } from '../schema';
import { createTestDb } from '../test-db';
import { listProjectsForUser } from './projects';

let db: Db;
let people: { mayaId: string; tomasId: string; lonelyId: string };

beforeAll(async () => {
  db = await createTestDb();
  people = await seedDemo(db);
});

describe('listProjectsForUser', () => {
  it("returns the client's projects in the order they were created", async () => {
    const result = await listProjectsForUser(db, people.mayaId);
    expect(result.map((p) => p.title)).toEqual([
      'Holiday pre-order page',
      "Chen's Bakery website",
      'Catering enquiry site',
      'Wholesale order portal',
      'Summer menu microsite',
    ]);
  });

  it('returns projects where the person is the freelancer', async () => {
    const titles = (await listProjectsForUser(db, people.tomasId)).map((p) => p.title);
    expect(titles).toContain("Chen's Bakery website");
    expect(titles).toContain('Harbour Books events page');
    expect(titles).not.toContain('Catering enquiry site');
  });

  it('attaches both people and the milestones in position order', async () => {
    const bakery = (await listProjectsForUser(db, people.mayaId)).find(
      (p) => p.title === "Chen's Bakery website",
    )!;
    expect(bakery.client.name).toBe('Maya Chen');
    expect(bakery.freelancer.name).toBe('Tomás Rivera');
    expect(bakery.finishedAt).toBeNull();
    expect(bakery.milestones.map((m) => [m.position, m.title, m.amountCents, m.state])).toEqual([
      [1, 'Homepage', 90000, 'released'],
      [2, 'Contact page', 60000, 'client_review'],
      [3, 'Online ordering', 120000, 'drafting'],
    ]);
  });

  it('returns the finish date of a finished project', async () => {
    const holiday = (await listProjectsForUser(db, people.mayaId)).find(
      (p) => p.title === 'Holiday pre-order page',
    )!;
    expect(holiday.finishedAt?.toISOString()).toBe('2026-08-12T15:00:00.000Z');
  });

  it('returns an empty list for a person with no projects', async () => {
    expect(await listProjectsForUser(db, people.lonelyId)).toEqual([]);
  });
});
