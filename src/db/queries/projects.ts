import { asc, eq, inArray, or } from 'drizzle-orm';
import { contractStatus, type ContractStatus, type DraftStatus } from '../../domain/contract';
import type { MilestoneState } from '../../domain/milestone-state';
import { criteriaVersions, milestones, projects, signatures, users, type Db } from '../schema';

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
