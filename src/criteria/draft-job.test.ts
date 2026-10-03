import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, getContract } from '../db/queries/contract';
import { users, type Db } from '../db/schema';
import { createTestDb } from '../db/test-db';
import { draftProject } from './draft-job';
import type { StructuredModel } from './drafter';

const answer = {
  criteria: [
    { description: 'The page loads', kind: 'machine', category: 'function', test_plan: 'Open it.', weight: 2 },
    { description: 'It looks right', kind: 'human', category: 'none', test_plan: 'The client looks.', weight: 1 },
  ],
};

let db: Db;
let mayaId: string;
let projectId: string;

beforeEach(async () => {
  db = await createTestDb();
  [{ id: mayaId }] = await db
    .insert(users)
    .values({ name: 'Maya Chen', email: 'maya@chensbakery.example', role: 'client' })
    .returning({ id: users.id });
  projectId = await createProject(
    db,
    {
      clientId: mayaId,
      title: "Chen's Bakery website",
      freelancerEmail: 'tomas@riverastudio.example',
      milestones: ['Homepage', 'Contact page', 'Online ordering'].map((title) => ({
        title,
        brief: `Everything needed for the ${title}.`,
        amountCents: 60000,
      })),
    },
    new Date('2026-10-02T12:00:00Z'),
  );
});

const statuses = async () => (await getContract(db, projectId, mayaId))!.milestones.map((m) => m.criteriaDraft);

describe('draftProject', () => {
  it('says once when every list in the project is ready', async () => {
    const ready: string[] = [];
    await draftProject(db, { generate: async () => answer }, projectId, undefined, async (milestoneId) => {
      ready.push(milestoneId);
    });
    const [home] = (await getContract(db, projectId, mayaId))!.milestones;
    expect(ready).toEqual([home.id]);
  });

  it('does not say the lists are ready while one failed', async () => {
    const ready: string[] = [];
    let calls = 0;
    const flaky: StructuredModel = {
      generate: async () => {
        calls += 1;
        if (calls <= 2) throw new Error('overloaded');
        return answer;
      },
    };
    await draftProject(db, flaky, projectId, undefined, async (milestoneId) => {
      ready.push(milestoneId);
    });
    expect(ready).toEqual([]);
  });

  it('drafts every queued milestone', async () => {
    const model: StructuredModel = { generate: async () => answer };
    await draftProject(db, model, projectId);

    expect(await statuses()).toEqual(['ready', 'ready', 'ready']);
    const [home] = (await getContract(db, projectId, mayaId))!.milestones;
    expect(home.version!.criteria.map((c) => c.shareCents)).toEqual([40000, 20000]);
  });

  it('marks only the milestone that could not be drafted as stopped', async () => {
    const model: StructuredModel = {
      generate: async ({ user }) => {
        if (user.includes('Milestone: Contact page')) throw new Error('overloaded');
        return answer;
      },
    };
    await draftProject(db, model, projectId);
    expect(await statuses()).toEqual(['ready', 'failed', 'ready']);
  });

  it('does nothing when there is nothing queued', async () => {
    let calls = 0;
    const model: StructuredModel = { generate: async () => (calls++, answer) };
    await draftProject(db, model, projectId);
    await draftProject(db, model, projectId);
    expect(calls).toBe(3);
  });
});
