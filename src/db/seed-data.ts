import { randomUUID } from 'node:crypto';
import type { CriterionCategory, CriterionKind } from '../domain/criteria';
import type { MilestoneState } from '../domain/milestone-state';
import { allocateShares } from '../domain/shares';
import { criteria, criteriaVersions, milestones, projects, signatures, users, type Db } from './schema';

export const DEMO_CLIENT_EMAIL = 'maya@chensbakery.example';
export const DEMO_FREELANCER_EMAIL = 'tomas@riverastudio.example';

type M = [title: string, amountCents: number, state: MilestoneState, criteriaDraft: 'pending' | 'ready'];

interface ProjectSeed {
  title: string;
  client: string;
  freelancer: string;
  createdAt: string;
  finishedAt?: string;
  milestones: M[];
}

const PEOPLE: Array<[key: string, name: string, email: string, role: 'client' | 'freelancer']> = [
  ['maya', 'Maya Chen', DEMO_CLIENT_EMAIL, 'client'],
  ['tomas', 'Tomás Rivera', DEMO_FREELANCER_EMAIL, 'freelancer'],
  ['priya', 'Priya Nair', 'priya@nairweb.example', 'freelancer'],
  ['dana', 'Dana Okafor', 'dana@okaforcode.example', 'freelancer'],
  ['idris', 'Idris Bello', 'idris@harbourbooks.example', 'client'],
  ['noor', 'Noor Haddad', 'noor@marketstalls.example', 'client'],
  ['lena', 'Lena Fischer', 'lena@studiolumen.example', 'client'],
  ['lonely', 'Sam Lonely', 'sam@noprojects.example', 'client'],
];

const PROJECTS: ProjectSeed[] = [
  {
    title: "Chen's Bakery website", client: 'maya', freelancer: 'tomas', createdAt: '2026-09-10T09:00:00Z',
    milestones: [
      ['Homepage', 90000, 'released', 'ready'],
      ['Contact page', 60000, 'client_review', 'ready'],
      ['Online ordering', 120000, 'drafting', 'ready'],
    ],
  },
  {
    title: 'Catering enquiry site', client: 'maya', freelancer: 'priya', createdAt: '2026-09-20T09:00:00Z',
    milestones: [
      ['Enquiry form', 45000, 'verifying', 'ready'],
      ['Menu page', 60000, 'drafting', 'ready'],
    ],
  },
  {
    title: 'Wholesale order portal', client: 'maya', freelancer: 'tomas', createdAt: '2026-09-28T09:00:00Z',
    milestones: [
      ['Login and account pages', 90000, 'drafting', 'ready'],
      ['Order history', 90000, 'drafting', 'ready'],
    ],
  },
  {
    title: 'Summer menu microsite', client: 'maya', freelancer: 'priya', createdAt: '2026-10-02T08:00:00Z',
    milestones: [
      ['Landing page', 70000, 'drafting', 'pending'],
      ['Menu', 70000, 'drafting', 'pending'],
      ['Booking link', 70000, 'drafting', 'pending'],
    ],
  },
  {
    title: 'Holiday pre-order page', client: 'maya', freelancer: 'dana', createdAt: '2026-08-01T09:00:00Z',
    finishedAt: '2026-08-12T15:00:00Z',
    milestones: [['Pre-order page', 40000, 'released', 'ready']],
  },
  {
    title: 'Harbour Books events page', client: 'idris', freelancer: 'tomas', createdAt: '2026-09-15T09:00:00Z',
    milestones: [
      ['Events list', 50000, 'released', 'ready'],
      ['Event detail', 70000, 'released', 'ready'],
      ['Ticket booking', 80000, 'verifying', 'ready'],
    ],
  },
  {
    title: 'Market stall finder', client: 'noor', freelancer: 'tomas', createdAt: '2026-10-02T08:30:00Z',
    milestones: [
      ['Stall map', 80000, 'drafting', 'pending'],
      ['Stall pages', 60000, 'drafting', 'pending'],
    ],
  },
  {
    title: 'Studio Lumen portfolio', client: 'lena', freelancer: 'tomas', createdAt: '2026-08-10T09:00:00Z',
    finishedAt: '2026-09-02T12:00:00Z',
    milestones: [
      ['Gallery', 70000, 'released', 'ready'],
      ['About and contact', 80000, 'released', 'ready'],
    ],
  },
];

type Check = [description: string, testPlan: string, kind: CriterionKind, category: CriterionCategory | null, weight: number];

const CHECKS: Check[] = [
  ['Everything the brief asks for works', 'Each feature in the brief is used once and behaves as described.', 'machine', 'function', 3],
  ['The page works at phone width', 'At 390 pixels wide, nothing overflows and every control can be used.', 'machine', 'responsive', 3],
  ['The page loads in under 3 seconds', 'Measured on a fresh visit, three times, taking the middle result.', 'machine', 'performance', 2],
  ['No links on the page are broken', 'Every link is opened and must load a real page.', 'machine', 'function', 2],
  ['The page matches the look of the rest of the site', 'A test cannot judge this, so the client will.', 'human', null, 2],
];

const CHANGED_SPEED: Check = [
  'The page loads in under 4 seconds on a phone connection',
  'Measured on a simulated 4G phone connection, three times, taking the middle result.',
  'machine',
  'performance',
  9,
];
const ADDED_CHECK: Check = [
  'The account page shows the customer name',
  'After logging in with the test account, the account page shows that account’s name.',
  'machine',
  'content',
  5,
];

async function insertList(
  db: Db,
  milestoneId: string,
  amountCents: number,
  version: number,
  authorId: string | null,
  reason: string,
  checks: Check[],
  keys: string[],
): Promise<string> {
  const [row] = await db
    .insert(criteriaVersions)
    .values({ milestoneId, version, authorId, reason })
    .returning({ id: criteriaVersions.id });
  const shares = allocateShares(amountCents, checks.map((check) => check[4]));
  await db.insert(criteria).values(
    checks.map(([description, testPlan, kind, category], index) => ({
      versionId: row.id,
      key: keys[index],
      position: index + 1,
      description,
      testPlan,
      kind,
      category,
      shareCents: shares[index],
    })),
  );
  return row.id;
}

export async function seedDemo(db: Db): Promise<{ mayaId: string; tomasId: string; lonelyId: string }> {
  const ids = new Map<string, string>();
  for (const [key, name, email, role] of PEOPLE) {
    const [row] = await db.insert(users).values({ name, email, role }).returning({ id: users.id });
    ids.set(key, row.id);
  }

  for (const project of PROJECTS) {
    const [row] = await db
      .insert(projects)
      .values({
        title: project.title,
        clientId: ids.get(project.client)!,
        freelancerId: ids.get(project.freelancer)!,
        createdAt: new Date(project.createdAt),
        finishedAt: project.finishedAt ? new Date(project.finishedAt) : null,
      })
      .returning({ id: projects.id });

    const milestoneRows = await db
      .insert(milestones)
      .values(
        project.milestones.map(([title, amountCents, state, criteriaDraft], index) => ({
          projectId: row.id,
          position: index + 1,
          title,
          amountCents,
          state,
          criteriaDraft,
        })),
      )
      .returning();

    for (const milestone of milestoneRows) {
      if (milestone.criteriaDraft !== 'ready') continue;
      const keys = CHECKS.map(() => randomUUID());
      const versionId = await insertList(db, milestone.id, milestone.amountCents, 1, null, '', CHECKS, keys);

      if (milestone.state !== 'drafting') {
        await db.insert(signatures).values(
          [project.client, project.freelancer].map((key) => {
            const [, name, email] = PEOPLE.find((person) => person[0] === key)!;
            return { versionId, userId: ids.get(key)!, signedName: name, signedEmail: email };
          }),
        );
      }

      if (project.title === 'Wholesale order portal' && milestone.position === 1) {
        const [works, phone, , links, look] = CHECKS;
        const reweigh = (check: Check, weight: number): Check => [check[0], check[1], check[2], check[3], weight];
        await insertList(
          db,
          milestone.id,
          milestone.amountCents,
          2,
          ids.get('tomas')!,
          'Order history pulls a lot of data, so 3 seconds is tight on mobile. I also added a check that the account page shows the right customer.',
          [reweigh(works, 14), reweigh(phone, 14), CHANGED_SPEED, reweigh(links, 9), ADDED_CHECK, reweigh(look, 9)],
          [keys[0], keys[1], keys[2], keys[3], randomUUID(), keys[4]],
        );
      }
    }
  }

  return { mayaId: ids.get('maya')!, tomasId: ids.get('tomas')!, lonelyId: ids.get('lonely')! };
}
