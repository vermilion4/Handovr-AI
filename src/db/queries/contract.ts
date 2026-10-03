import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import { DRAFT_STALE_MS, namesMatch, type DraftStatus } from '../../domain/contract';
import {
  checkCriteriaList,
  diffCriteria,
  isEmptyDiff,
  type CriterionFields,
  type DraftedCriterion,
} from '../../domain/criteria';
import { transition, type MilestoneState } from '../../domain/milestone-state';
import { criteria, criteriaVersions, milestones, projects, signatures, users, type Db } from '../schema';

export interface NewProjectInput {
  clientId: string;
  title: string;
  freelancerEmail: string;
  milestones: Array<{ title: string; brief: string; amountCents: number }>;
}

export async function createProject(db: Db, input: NewProjectInput, now: Date): Promise<string> {
  return db.transaction(async (tx) => {
    const email = input.freelancerEmail.trim().toLowerCase();
    let [freelancer] = await tx
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (freelancer?.role === 'client') throw new Error(`${email} is a client account and cannot be a freelancer.`);
    if (!freelancer) {
      [freelancer] = await tx
        .insert(users)
        .values({ name: email.split('@')[0], email, role: 'freelancer' })
        .returning({ id: users.id, role: users.role });
    }

    const [project] = await tx
      .insert(projects)
      .values({ clientId: input.clientId, freelancerId: freelancer.id, title: input.title.trim(), createdAt: now })
      .returning({ id: projects.id });

    await tx.insert(milestones).values(
      input.milestones.map((milestone, index) => ({
        projectId: project.id,
        position: index + 1,
        title: milestone.title.trim(),
        brief: milestone.brief.trim(),
        amountCents: milestone.amountCents,
        criteriaDraft: 'pending' as const,
        criteriaDraftStartedAt: now,
      })),
    );
    return project.id;
  });
}

export interface DraftJob {
  milestoneId: string;
  projectTitle: string;
  title: string;
  brief: string;
  amountCents: number;
}

export async function listPendingDrafts(db: Db, projectId: string): Promise<string[]> {
  const rows = await db
    .select({ id: milestones.id })
    .from(milestones)
    .where(and(eq(milestones.projectId, projectId), eq(milestones.criteriaDraft, 'pending')))
    .orderBy(asc(milestones.position));
  return rows.map((row) => row.id);
}

export async function claimDraft(db: Db, milestoneId: string, now: Date): Promise<DraftJob | null> {
  const [row] = await db
    .update(milestones)
    .set({ criteriaDraft: 'drafting', criteriaDraftStartedAt: now })
    .where(and(eq(milestones.id, milestoneId), eq(milestones.criteriaDraft, 'pending')))
    .returning();
  if (!row) return null;

  const [project] = await db.select({ title: projects.title }).from(projects).where(eq(projects.id, row.projectId));
  return {
    milestoneId: row.id,
    projectTitle: project.title,
    title: row.title,
    brief: row.brief,
    amountCents: row.amountCents,
  };
}

export async function insertVersion(
  db: Db,
  version: { milestoneId: string; number: number; authorId: string | null; reason: string },
  items: CriterionFields[],
): Promise<string> {
  const [row] = await db
    .insert(criteriaVersions)
    .values({
      milestoneId: version.milestoneId,
      version: version.number,
      authorId: version.authorId,
      reason: version.reason,
    })
    .returning({ id: criteriaVersions.id });

  await db.insert(criteria).values(
    items.map((item, index) => ({
      versionId: row.id,
      key: item.key,
      position: index + 1,
      description: item.description.trim(),
      testPlan: item.testPlan.trim(),
      kind: item.kind,
      category: item.category,
      shareCents: item.shareCents,
    })),
  );
  return row.id;
}

export async function saveDraft(db: Db, milestoneId: string, items: DraftedCriterion[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.select({ id: milestones.id }).from(milestones).where(eq(milestones.id, milestoneId)).for('update');
    if (!(await latestVersion(tx, milestoneId))) {
      await insertVersion(
        tx,
        { milestoneId, number: 1, authorId: null, reason: '' },
        items.map((item) => ({ ...item, key: randomUUID() })),
      );
    }
    await tx.update(milestones).set({ criteriaDraft: 'ready' }).where(eq(milestones.id, milestoneId));
  });
}

export async function failDraft(db: Db, milestoneId: string): Promise<void> {
  await db
    .update(milestones)
    .set({ criteriaDraft: 'failed' })
    .where(and(eq(milestones.id, milestoneId), eq(milestones.criteriaDraft, 'drafting')));
}

export async function requeueDrafts(db: Db, projectId: string, now: Date): Promise<void> {
  const staleBefore = new Date(now.getTime() - DRAFT_STALE_MS);
  await db
    .update(milestones)
    .set({ criteriaDraft: 'pending', criteriaDraftStartedAt: now })
    .where(
      and(
        eq(milestones.projectId, projectId),
        or(
          eq(milestones.criteriaDraft, 'failed'),
          eq(milestones.criteriaDraft, 'pending'),
          and(
            eq(milestones.criteriaDraft, 'drafting'),
            or(isNull(milestones.criteriaDraftStartedAt), lt(milestones.criteriaDraftStartedAt, staleBefore)),
          ),
        ),
      ),
    );
}

export interface ContractVersion {
  id: string;
  number: number;
  authorId: string | null;
  reason: string;
  acknowledged: boolean;
  signedBy: string[];
  criteria: CriterionFields[];
  /** The list this one replaced, for marking what changed. */
  previous: CriterionFields[] | null;
}

export interface ContractMilestone {
  id: string;
  position: number;
  title: string;
  brief: string;
  amountCents: number;
  state: MilestoneState;
  criteriaDraft: DraftStatus;
  criteriaDraftStartedAt: Date | null;
  version: ContractVersion | null;
}

export interface ContractView {
  project: { id: string; title: string };
  viewerRole: 'client' | 'freelancer';
  client: { id: string; name: string };
  freelancer: { id: string; name: string };
  milestones: ContractMilestone[];
}

export async function latestVersion(db: Db, milestoneId: string) {
  const [row] = await db
    .select()
    .from(criteriaVersions)
    .where(eq(criteriaVersions.milestoneId, milestoneId))
    .orderBy(desc(criteriaVersions.version))
    .limit(1);
  return row ?? null;
}

export async function criteriaOf(db: Db, versionId: string): Promise<CriterionFields[]> {
  const rows = await db.select().from(criteria).where(eq(criteria.versionId, versionId)).orderBy(asc(criteria.position));
  return rows.map(toFields);
}

function toFields(row: typeof criteria.$inferSelect): CriterionFields {
  return {
    key: row.key,
    description: row.description,
    testPlan: row.testPlan,
    kind: row.kind,
    category: row.category,
    shareCents: row.shareCents,
  };
}

export async function getContract(db: Db, projectId: string, viewerId: string): Promise<ContractView | null> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project || (project.clientId !== viewerId && project.freelancerId !== viewerId)) return null;

  const people = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, [project.clientId, project.freelancerId]));
  const milestoneRows = await db
    .select()
    .from(milestones)
    .where(eq(milestones.projectId, projectId))
    .orderBy(asc(milestones.position));

  const milestoneIds = milestoneRows.map((row) => row.id);
  const versionRows = milestoneIds.length
    ? await db
        .select()
        .from(criteriaVersions)
        .where(inArray(criteriaVersions.milestoneId, milestoneIds))
        .orderBy(asc(criteriaVersions.version))
    : [];
  const versionIds = versionRows.map((row) => row.id);
  const criteriaRows = versionIds.length
    ? await db.select().from(criteria).where(inArray(criteria.versionId, versionIds)).orderBy(asc(criteria.position))
    : [];
  const signatureRows = versionIds.length
    ? await db.select().from(signatures).where(inArray(signatures.versionId, versionIds))
    : [];

  const listFor = (versionId: string) => criteriaRows.filter((row) => row.versionId === versionId).map(toFields);

  return {
    project: { id: project.id, title: project.title },
    viewerRole: project.clientId === viewerId ? 'client' : 'freelancer',
    client: people.find((person) => person.id === project.clientId)!,
    freelancer: people.find((person) => person.id === project.freelancerId)!,
    milestones: milestoneRows.map((row) => {
      const versions = versionRows.filter((version) => version.milestoneId === row.id);
      const latest = versions.at(-1);
      // The list as it stood before the latest author's run of changes.
      const before = versions.findLast((version) => version.authorId !== latest?.authorId);
      return {
        id: row.id,
        position: row.position,
        title: row.title,
        brief: row.brief,
        amountCents: row.amountCents,
        state: row.state,
        criteriaDraft: row.criteriaDraft,
        criteriaDraftStartedAt: row.criteriaDraftStartedAt,
        version: latest
          ? {
              id: latest.id,
              number: latest.version,
              authorId: latest.authorId,
              reason: latest.reason,
              acknowledged: latest.acknowledgedAt !== null,
              signedBy: signatureRows.filter((s) => s.versionId === latest.id).map((s) => s.userId),
              criteria: listFor(latest.id),
              previous: before ? listFor(before.id) : null,
            }
          : null,
      };
    }),
  };
}

export type Outcome = { ok: true } | { ok: false; reason: string };

/** Thrown inside a transaction to undo it and report the reason to the person. */
class Refusal extends Error {}

async function refusable<T>(run: () => Promise<T>): Promise<T | { ok: false; reason: string }> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, reason: error.message };
    throw error;
  }
}

async function milestoneForParty(db: Db, milestoneId: string, userId: string) {
  // Locking the milestone makes changes and signatures on it happen one at a time.
  const [milestone] = await db.select().from(milestones).where(eq(milestones.id, milestoneId)).limit(1).for('update');
  if (!milestone) throw new Refusal('That milestone does not exist.');
  const [project] = await db.select().from(projects).where(eq(projects.id, milestone.projectId)).limit(1);
  if (project.clientId !== userId && project.freelancerId !== userId) throw new Refusal('You are not on this project.');
  return { milestone, project };
}

export async function saveEdit(
  db: Db,
  input: { milestoneId: string; authorId: string; baseVersionId: string; items: CriterionFields[]; reason: string },
): Promise<Outcome> {
  return refusable(() =>
    db.transaction(async (tx) => {
      const { milestone } = await milestoneForParty(tx, input.milestoneId, input.authorId);
      if (milestone.state !== 'drafting') throw new Refusal('These checks are signed and can no longer be changed.');

      const latest = await latestVersion(tx, milestone.id);
      if (!latest) throw new Refusal('The checks are still being drafted.');
      if (latest.id !== input.baseVersionId) {
        throw new Refusal('The list changed while you were editing. Reload to see the latest version.');
      }

      const problem = checkCriteriaList(milestone.amountCents, input.items);
      if (problem) throw new Refusal(problem);
      if (isEmptyDiff(diffCriteria(await criteriaOf(tx, latest.id), input.items))) {
        throw new Refusal('Nothing has changed.');
      }

      await insertVersion(
        tx,
        { milestoneId: milestone.id, number: latest.version + 1, authorId: input.authorId, reason: input.reason.trim() },
        input.items,
      );
      return { ok: true as const };
    }),
  );
}

export async function acknowledgeVersion(
  db: Db,
  input: { versionId: string; userId: string; now: Date },
): Promise<Outcome> {
  return refusable(() =>
    db.transaction(async (tx) => {
      const [version] = await tx.select().from(criteriaVersions).where(eq(criteriaVersions.id, input.versionId)).limit(1);
      if (!version) throw new Refusal('That list does not exist.');
      await milestoneForParty(tx, version.milestoneId, input.userId);

      const latest = await latestVersion(tx, version.milestoneId);
      if (latest?.id !== version.id) throw new Refusal('The list changed. Reload to see the latest version.');
      if (version.authorId === null || version.authorId === input.userId) {
        throw new Refusal('There is nothing to accept.');
      }

      await tx.update(criteriaVersions).set({ acknowledgedAt: input.now }).where(eq(criteriaVersions.id, version.id));
      return { ok: true as const };
    }),
  );
}

export async function signMilestones(
  db: Db,
  input: { projectId: string; userId: string; versionIds: string[]; typedName: string; agreed: boolean; now: Date },
): Promise<{ ok: true; signed: number; completed: number; completedIds: string[] } | { ok: false; reason: string }> {
  if (!input.agreed) return { ok: false, reason: 'Tick the box to agree before signing.' };
  const versionIds = [...new Set(input.versionIds)].sort();
  if (versionIds.length === 0) return { ok: false, reason: 'Choose at least one milestone to sign.' };

  return refusable(() =>
    db.transaction(async (tx) => {
      const [project] = await tx.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
      if (!project || (project.clientId !== input.userId && project.freelancerId !== input.userId)) {
        throw new Refusal('You are not on this project.');
      }
      const [user] = await tx.select().from(users).where(eq(users.id, input.userId)).limit(1);
      if (!namesMatch(input.typedName, user.name)) {
        throw new Refusal(`Type your full name as it appears on your account: ${user.name}.`);
      }

      const completedIds: string[] = [];
      for (const versionId of versionIds) {
        const [version] = await tx.select().from(criteriaVersions).where(eq(criteriaVersions.id, versionId)).limit(1);
        const [milestone] = version
          ? await tx.select().from(milestones).where(eq(milestones.id, version.milestoneId)).limit(1).for('update')
          : [];
        if (!version || !milestone || milestone.projectId !== project.id) {
          throw new Refusal('That list does not belong to this project.');
        }
        if (milestone.state !== 'drafting') {
          throw new Refusal(`"${milestone.title}" is already signed by both of you.`);
        }
        const latest = await latestVersion(tx, milestone.id);
        if (latest?.id !== version.id) {
          throw new Refusal(`The "${milestone.title}" list changed. Reload to see the latest version.`);
        }
        if (version.authorId !== null && version.authorId !== input.userId && version.acknowledgedAt === null) {
          throw new Refusal(`Accept the changes to "${milestone.title}" before signing it.`);
        }

        await tx
          .insert(signatures)
          .values({
            versionId,
            userId: input.userId,
            signedName: input.typedName.trim(),
            signedEmail: user.email,
            signedAt: input.now,
          })
          .onConflictDoNothing();

        const signers = await tx.select({ userId: signatures.userId }).from(signatures).where(eq(signatures.versionId, versionId));
        const signedBy = new Set(signers.map((row) => row.userId));
        if (signedBy.has(project.clientId) && signedBy.has(project.freelancerId)) {
          const result = transition(
            { state: milestone.state, attemptsUsed: milestone.attemptsUsed, submittedFrom: null, releaseKind: null, returnTo: null },
            { type: 'criteria_signed' },
          );
          if (!result.ok) throw new Refusal(result.reason);
          await tx.update(milestones).set({ state: result.context.state }).where(eq(milestones.id, milestone.id));
          completedIds.push(milestone.id);
        }
      }
      return { ok: true as const, signed: versionIds.length, completed: completedIds.length, completedIds };
    }),
  );
}

export const DECLINED_REASON = 'Declined the changes and kept the earlier list.';

/** Undoes the other person's unaccepted changes by saving the list as it stood before them. */
export async function declineVersion(db: Db, input: { versionId: string; userId: string }): Promise<Outcome> {
  return refusable(() =>
    db.transaction(async (tx) => {
      const [version] = await tx.select().from(criteriaVersions).where(eq(criteriaVersions.id, input.versionId)).limit(1);
      if (!version) throw new Refusal('That list does not exist.');
      const { milestone } = await milestoneForParty(tx, version.milestoneId, input.userId);

      const versions = await tx
        .select()
        .from(criteriaVersions)
        .where(eq(criteriaVersions.milestoneId, milestone.id))
        .orderBy(asc(criteriaVersions.version));
      const latest = versions.at(-1)!;
      if (latest.id !== version.id) throw new Refusal('The list changed. Reload to see the latest version.');
      if (version.authorId === null || version.authorId === input.userId || version.acknowledgedAt !== null) {
        throw new Refusal('There is nothing to decline.');
      }

      const earlier = versions.findLast((candidate) => candidate.authorId !== version.authorId);
      if (!earlier) throw new Refusal('There is no earlier list to go back to.');

      await insertVersion(
        tx,
        { milestoneId: milestone.id, number: latest.version + 1, authorId: input.userId, reason: DECLINED_REASON },
        await criteriaOf(tx, earlier.id),
      );
      return { ok: true as const };
    }),
  );
}
