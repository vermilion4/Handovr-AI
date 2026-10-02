import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DraftedCriterion } from '../../domain/criteria';
import { milestones, users, type Db } from '../schema';
import { createTestDb } from '../test-db';
import {
  claimDraft,
  createProject,
  failDraft,
  getContract,
  listPendingDrafts,
  requeueDrafts,
  saveDraft,
} from './contract';

const now = new Date('2026-10-02T12:00:00Z');
const later = (seconds: number) => new Date(now.getTime() + seconds * 1000);

const drafted: DraftedCriterion[] = [
  { description: 'The form sends a message', testPlan: 'Fill it in and press Send.', kind: 'machine', category: 'function', shareCents: 30000 },
  { description: 'Works at phone width', testPlan: 'View at 390 pixels wide.', kind: 'machine', category: 'responsive', shareCents: 20000 },
  { description: 'Matches the homepage', testPlan: 'The client compares the two pages.', kind: 'human', category: null, shareCents: 10000 },
];

let db: Db;
let mayaId: string;
let tomasId: string;

async function person(name: string, email: string, role: 'client' | 'freelancer'): Promise<string> {
  const [row] = await db.insert(users).values({ name, email, role }).returning({ id: users.id });
  return row.id;
}

async function bakery(freelancerEmail = 'tomas@riverastudio.example'): Promise<string> {
  return createProject(
    db,
    {
      clientId: mayaId,
      title: " Chen's Bakery website ",
      freelancerEmail,
      milestones: [
        { title: 'Homepage', brief: 'A homepage with opening hours.', amountCents: 90000 },
        { title: 'Contact page', brief: 'A contact page with a form.', amountCents: 60000 },
      ],
    },
    now,
  );
}

beforeEach(async () => {
  db = await createTestDb();
  mayaId = await person('Maya Chen', 'maya@chensbakery.example', 'client');
  tomasId = await person('Tomás Rivera', 'tomas@riverastudio.example', 'freelancer');
});

describe('createProject', () => {
  it('stores the project with its milestones queued for drafting', async () => {
    const projectId = await bakery();
    const contract = (await getContract(db, projectId, mayaId))!;

    expect(contract.project.title).toBe("Chen's Bakery website");
    expect(contract.viewerRole).toBe('client');
    expect(contract.freelancer).toEqual({ id: tomasId, name: 'Tomás Rivera' });
    expect(contract.milestones.map((m) => [m.position, m.title, m.amountCents, m.criteriaDraft])).toEqual([
      [1, 'Homepage', 90000, 'pending'],
      [2, 'Contact page', 60000, 'pending'],
    ]);
    expect(contract.milestones[0].criteriaDraftStartedAt).toEqual(now);
    expect(contract.milestones[0].version).toBeNull();
  });

  it('matches an existing person by email whatever the capitals', async () => {
    const projectId = await bakery('Tomas@RiveraStudio.example');
    expect((await getContract(db, projectId, mayaId))!.freelancer.id).toBe(tomasId);
  });

  it('creates a placeholder person for an email it has not seen', async () => {
    const projectId = await bakery('New.Dev@Example.com');
    const contract = (await getContract(db, projectId, mayaId))!;
    const [created] = await db.select().from(users).where(eq(users.id, contract.freelancer.id));
    expect(created).toMatchObject({ email: 'new.dev@example.com', name: 'new.dev', role: 'freelancer' });
  });
});

describe('createProject with a client as the freelancer', () => {
  it('refuses, and creates nothing', async () => {
    await person('Idris Bello', 'idris@harbourbooks.example', 'client');
    await expect(bakery('idris@harbourbooks.example')).rejects.toThrow('client account');
    expect(await db.select().from(milestones)).toHaveLength(0);
  });
});

describe('getContract', () => {
  it('shows the freelancer the same project from their side', async () => {
    const projectId = await bakery();
    expect((await getContract(db, projectId, tomasId))!.viewerRole).toBe('freelancer');
  });

  it('returns nothing to someone who is not on the project', async () => {
    const projectId = await bakery();
    const strangerId = await person('Sam Stranger', 'sam@elsewhere.example', 'client');
    expect(await getContract(db, projectId, strangerId)).toBeNull();
  });

  it('returns nothing for a project that does not exist', async () => {
    expect(await getContract(db, '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b', mayaId)).toBeNull();
  });
});

describe('drafting', () => {
  it('lets one worker claim a queued milestone, and nobody claim it twice', async () => {
    const projectId = await bakery();
    const [first] = await listPendingDrafts(db, projectId);

    const job = await claimDraft(db, first, later(1));
    expect(job).toEqual({
      milestoneId: first,
      projectTitle: "Chen's Bakery website",
      title: 'Homepage',
      brief: 'A homepage with opening hours.',
      amountCents: 90000,
    });
    expect(await claimDraft(db, first, later(2))).toBeNull();
    expect(await listPendingDrafts(db, projectId)).toHaveLength(1);
  });

  it('stores a draft as version 1 written by Handovr and marks the milestone ready', async () => {
    const projectId = await bakery();
    const [, contactId] = await listPendingDrafts(db, projectId);
    await claimDraft(db, contactId, now);
    await saveDraft(db, contactId, drafted);

    const contact = (await getContract(db, projectId, mayaId))!.milestones[1];
    expect(contact.criteriaDraft).toBe('ready');
    expect(contact.version).toMatchObject({ number: 1, authorId: null, reason: '', acknowledged: false, signedBy: [], previous: null });
    expect(contact.version!.criteria).toEqual(drafted.map((item) => ({ ...item, key: expect.any(String) })));
    expect(new Set(contact.version!.criteria.map((c) => c.key)).size).toBe(3);
  });

  it('marks a milestone as stopped when drafting fails', async () => {
    const projectId = await bakery();
    const [first] = await listPendingDrafts(db, projectId);
    await claimDraft(db, first, now);
    await failDraft(db, first);
    expect((await getContract(db, projectId, mayaId))!.milestones[0].criteriaDraft).toBe('failed');
  });

  it('queues stopped and stuck milestones again, and leaves fresh work and finished lists alone', async () => {
    const projectId = await createProject(
      db,
      {
        clientId: mayaId,
        title: 'Four milestones',
        freelancerEmail: 'tomas@riverastudio.example',
        milestones: ['Stopped', 'Stuck', 'Fresh', 'Done'].map((title) => ({ title, brief: 'A brief for this milestone.', amountCents: 60000 })),
      },
      now,
    );
    const [stopped, stuck, fresh, done] = await listPendingDrafts(db, projectId);
    await claimDraft(db, stopped, now);
    await failDraft(db, stopped);
    await claimDraft(db, stuck, now);
    await claimDraft(db, fresh, later(290));
    await claimDraft(db, done, now);
    await saveDraft(db, done, drafted);

    await requeueDrafts(db, projectId, later(300));

    const rows = await db.select().from(milestones).where(eq(milestones.projectId, projectId)).orderBy(milestones.position);
    expect(rows.map((row) => row.criteriaDraft)).toEqual(['pending', 'pending', 'drafting', 'ready']);
    expect(rows[0].criteriaDraftStartedAt).toEqual(later(300));
  });

  it('keeps a finished list when a late job for the same milestone ends', async () => {
    const projectId = await bakery();
    const [first] = await listPendingDrafts(db, projectId);
    await claimDraft(db, first, now);
    await saveDraft(db, first, drafted);

    await saveDraft(db, first, [{ ...drafted[0], shareCents: 90000 }]);
    await failDraft(db, first);

    const home = (await getContract(db, projectId, mayaId))!.milestones[0];
    expect(home.criteriaDraft).toBe('ready');
    expect(home.version).toMatchObject({ number: 1 });
    expect(home.version!.criteria).toHaveLength(3);
  });
});
