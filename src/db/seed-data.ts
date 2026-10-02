import type { MilestoneState } from '../domain/milestone-state';
import { milestones, projects, users, type Db } from './schema';

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

    await db.insert(milestones).values(
      project.milestones.map(([title, amountCents, state, criteriaDraft], index) => ({
        projectId: row.id,
        position: index + 1,
        title,
        amountCents,
        state,
        criteriaDraft,
      })),
    );
  }

  return { mayaId: ids.get('maya')!, tomasId: ids.get('tomas')!, lonelyId: ids.get('lonely')! };
}
