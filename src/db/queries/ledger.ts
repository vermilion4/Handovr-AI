import { and, eq, inArray, or } from 'drizzle-orm';
import type { LedgerEvent } from '../../domain/ledger';
import { holds, milestones, paymentEvents, projects, users, type Db } from '../schema';

export async function listLedger(
  db: Db,
  userId: string,
): Promise<{
  role: 'client' | 'freelancer';
  events: LedgerEvent[];
  activeHolds: Array<{ amountCents: number; totalCents: number }>;
}> {
  const [viewer] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  const role = viewer?.role ?? 'client';

  const projectRows = await db
    .select()
    .from(projects)
    .where(or(eq(projects.clientId, userId), eq(projects.freelancerId, userId)));
  if (projectRows.length === 0) return { role, events: [], activeHolds: [] };

  const projectIds = projectRows.map((project) => project.id);
  const people = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, projectRows.flatMap((project) => [project.clientId, project.freelancerId])));
  const nameOf = new Map(people.map((person) => [person.id, person.name]));
  const projectOf = new Map(projectRows.map((project) => [project.id, project]));

  const rows = await db
    .select({ event: paymentEvents, milestone: milestones, hold: holds })
    .from(paymentEvents)
    .innerJoin(milestones, eq(milestones.id, paymentEvents.milestoneId))
    .innerJoin(holds, eq(holds.id, paymentEvents.holdId))
    .where(inArray(milestones.projectId, projectIds));

  const activeHolds = await db
    .select({ amountCents: holds.amountCents, totalCents: holds.totalCents })
    .from(holds)
    .innerJoin(milestones, eq(milestones.id, holds.milestoneId))
    .where(and(inArray(milestones.projectId, projectIds), eq(holds.status, 'active')));

  return {
    role,
    activeHolds,
    events: rows.map(({ event, milestone, hold }) => {
      const project = projectOf.get(milestone.projectId)!;
      const counterpartId = project.clientId === userId ? project.freelancerId : project.clientId;
      return {
        id: event.id,
        at: event.updatedAt,
        projectTitle: project.title,
        milestoneTitle: milestone.title,
        counterpartName: nameOf.get(counterpartId) ?? '',
        type: event.type,
        status: event.status,
        amountCents: event.amountCents,
        holdAmountCents: hold.amountCents,
        paypalId: event.paypalId,
        detail: event.detail,
      };
    }),
  };
}
