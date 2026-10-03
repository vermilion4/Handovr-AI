import { and, asc, desc, eq, inArray, max, min, or } from 'drizzle-orm';
import { contractStatus, type ContractStatus, type DraftStatus } from '../../domain/contract';
import type { MilestoneState } from '../../domain/milestone-state';
import type { TimelineMilestone } from '../../domain/timeline';
import { criteriaVersions, holds, milestones, notifications, paymentEvents, projects, signatures, users, type Db } from '../schema';

export interface MilestoneRow {
  id: string;
  position: number;
  title: string;
  amountCents: number;
  state: MilestoneState;
  criteriaDraft: DraftStatus;
  contract: ContractStatus;
}

export interface ProjectWithMilestones {
  id: string;
  title: string;
  finishedAt: Date | null;
  client: { id: string; name: string };
  freelancer: { id: string; name: string };
  milestones: MilestoneRow[];
}

/** Every project the person is the client or the freelancer on, oldest first. */
export async function listProjectsForUser(db: Db, userId: string): Promise<ProjectWithMilestones[]> {
  const projectRows = await db
    .select()
    .from(projects)
    .where(or(eq(projects.clientId, userId), eq(projects.freelancerId, userId)))
    .orderBy(asc(projects.createdAt));

  if (projectRows.length === 0) return [];

  const projectIds = projectRows.map((p) => p.id);
  const personIds = [...new Set(projectRows.flatMap((p) => [p.clientId, p.freelancerId]))];

  const milestoneRows = await db
    .select()
    .from(milestones)
    .where(inArray(milestones.projectId, projectIds))
    .orderBy(asc(milestones.position));

  const personRows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, personIds));

  const people = new Map(personRows.map((p) => [p.id, p]));

  // The latest list of each milestone still being agreed, and who has signed it.
  const unsignedIds = milestoneRows.filter((m) => m.state === 'drafting' && m.criteriaDraft === 'ready').map((m) => m.id);
  const versionRows = unsignedIds.length
    ? await db
        .select()
        .from(criteriaVersions)
        .where(inArray(criteriaVersions.milestoneId, unsignedIds))
        .orderBy(asc(criteriaVersions.version))
    : [];
  const latest = new Map(versionRows.map((version) => [version.milestoneId, version]));
  const latestIds = [...latest.values()].map((version) => version.id);
  const signatureRows = latestIds.length
    ? await db.select().from(signatures).where(inArray(signatures.versionId, latestIds))
    : [];

  const contractOf = (milestone: (typeof milestoneRows)[number]): ContractStatus => {
    const version = latest.get(milestone.id);
    return contractStatus(
      {
        state: milestone.state,
        criteriaDraft: milestone.criteriaDraft,
        version: version
          ? {
              authorId: version.authorId,
              acknowledged: version.acknowledgedAt !== null,
              signedBy: signatureRows.filter((s) => s.versionId === version.id).map((s) => s.userId),
            }
          : null,
      },
      userId,
    );
  };

  return projectRows.map((project) => ({
    id: project.id,
    title: project.title,
    finishedAt: project.finishedAt,
    client: people.get(project.clientId)!,
    freelancer: people.get(project.freelancerId)!,
    milestones: milestoneRows
      .filter((m) => m.projectId === project.id)
      .map((m) => ({
        id: m.id,
        position: m.position,
        title: m.title,
        amountCents: m.amountCents,
        state: m.state,
        criteriaDraft: m.criteriaDraft,
        contract: contractOf(m),
      })),
  }));
}

/** The viewer's latest notifications about one project. */
export async function recentActivity(db: Db, projectId: string, userId: string): Promise<Array<{ id: string; subject: string; at: Date }>> {
  const rows = await db
    .select({ id: notifications.id, subject: notifications.subject, at: notifications.createdAt })
    .from(notifications)
    .innerJoin(milestones, eq(milestones.id, notifications.milestoneId))
    .where(and(eq(milestones.projectId, projectId), eq(notifications.userId, userId)))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(8);
  return rows;
}

// Aggregates can arrive as strings from the Postgres driver.
const toDate = (value: Date | string | null | undefined) => (value ? new Date(value) : null);

/** When each milestone of a project was funded and when it ended, for the timeline. */
export async function timelineFacts(db: Db, projectId: string): Promise<{ projectStart: Date; milestones: TimelineMilestone[] }> {
  const [project] = await db.select({ createdAt: projects.createdAt }).from(projects).where(eq(projects.id, projectId));
  const rows = await db.select().from(milestones).where(eq(milestones.projectId, projectId)).orderBy(asc(milestones.position));
  const ids = rows.map((row) => row.id);
  const funded = ids.length
    ? await db
        .select({ milestoneId: holds.milestoneId, at: min(holds.authorizedAt), expiresAt: max(holds.expiresAt) })
        .from(holds)
        .where(inArray(holds.milestoneId, ids))
        .groupBy(holds.milestoneId)
    : [];
  const ended = ids.length
    ? await db
        .select({ milestoneId: paymentEvents.milestoneId, at: max(paymentEvents.updatedAt) })
        .from(paymentEvents)
        .where(and(inArray(paymentEvents.milestoneId, ids), inArray(paymentEvents.type, ['payout', 'void']), eq(paymentEvents.status, 'completed')))
        .groupBy(paymentEvents.milestoneId)
    : [];

  return {
    projectStart: project.createdAt,
    milestones: rows.map((row) => {
      const hold = funded.find((item) => item.milestoneId === row.id);
      const end = toDate(ended.find((item) => item.milestoneId === row.id)?.at) ?? (row.state === 'lapsed' ? toDate(hold?.expiresAt) : null);
      return { id: row.id, position: row.position, title: row.title, state: row.state, fundedAt: toDate(hold?.at), endedAt: end };
    }),
  };
}
