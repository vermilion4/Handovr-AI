import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { CriterionFields } from '../../domain/criteria';
import type { MilestoneState } from '../../domain/milestone-state';
import type { PaymentStatus, PaymentType } from '../../domain/payments';
import type { AiVerdict, ClientDecision } from '../../domain/verification';
import {
  criteria,
  evidence,
  milestones,
  paymentEvents,
  projects,
  submissions,
  users,
  verdicts,
  type Db,
  type SubmissionStatus,
} from '../schema';
import { latestVersion } from './contract';

export interface MilestoneView {
  project: { id: string; title: string };
  viewerRole: 'client' | 'freelancer';
  client: { id: string; name: string; email: string };
  freelancer: { id: string; name: string; email: string };
  milestone: {
    id: string;
    position: number;
    title: string;
    amountCents: number;
    state: MilestoneState;
    attemptsUsed: number;
    reviewDueAt: Date | null;
  };
  milestoneCount: number;
  criteria: Array<CriterionFields & { id: string }>;
  submission: null | {
    id: string;
    attempt: number;
    url: string;
    repoUrl: string | null;
    status: SubmissionStatus;
    currentCriterionId: string | null;
    progressNote: string;
    replayUrl: string | null;
    createdAt: Date;
    finishedAt: Date | null;
  };
  verdicts: Array<{ id: string; criterionId: string; source: 'ai' | 'client'; verdict: AiVerdict | ClientDecision; summary: string }>;
  evidence: Array<{
    id: string;
    verdictId: string | null;
    kind: 'screenshot' | 'note' | 'timing' | 'console';
    caption: string;
    text: string;
    hasImage: boolean;
  }>;
  payments: Array<{ type: PaymentType; status: PaymentStatus; amountCents: number; at: Date }>;
}

export async function getMilestoneView(
  db: Db,
  projectId: string,
  milestoneId: string,
  viewerId: string,
): Promise<MilestoneView | null> {
  const [row] = await db
    .select({ milestone: milestones, project: projects })
    .from(milestones)
    .innerJoin(projects, eq(projects.id, milestones.projectId))
    .where(and(eq(milestones.id, milestoneId), eq(projects.id, projectId)))
    .limit(1);
  if (!row || (row.project.clientId !== viewerId && row.project.freelancerId !== viewerId)) return null;
  const { milestone, project } = row;

  const people = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, [project.clientId, project.freelancerId]));
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(milestones)
    .where(eq(milestones.projectId, project.id));

  const version = await latestVersion(db, milestone.id);
  const criteriaRows = version
    ? await db.select().from(criteria).where(eq(criteria.versionId, version.id)).orderBy(asc(criteria.position))
    : [];

  const [submission] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.milestoneId, milestone.id))
    .orderBy(desc(submissions.createdAt))
    .limit(1);

  // Results come from the newest submission the tester could open, so an unreachable resubmission hides nothing.
  const [tested] = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(and(eq(submissions.milestoneId, milestone.id), ne(submissions.status, 'unreachable')))
    .orderBy(desc(submissions.createdAt))
    .limit(1);

  const verdictRows = tested
    ? await db.select().from(verdicts).where(eq(verdicts.submissionId, tested.id)).orderBy(asc(verdicts.createdAt))
    : [];
  const evidenceRows = tested
    ? await db
        .select({
          id: evidence.id,
          verdictId: evidence.verdictId,
          kind: evidence.kind,
          caption: evidence.caption,
          text: evidence.text,
          hasImage: isNotNull(evidence.image),
        })
        .from(evidence)
        .where(eq(evidence.submissionId, tested.id))
        .orderBy(asc(evidence.createdAt))
    : [];
  const paymentRows = await db
    .select()
    .from(paymentEvents)
    .where(eq(paymentEvents.milestoneId, milestone.id))
    .orderBy(asc(paymentEvents.createdAt));

  return {
    project: { id: project.id, title: project.title },
    viewerRole: project.clientId === viewerId ? 'client' : 'freelancer',
    client: people.find((person) => person.id === project.clientId)!,
    freelancer: people.find((person) => person.id === project.freelancerId)!,
    milestone: {
      id: milestone.id,
      position: milestone.position,
      title: milestone.title,
      amountCents: milestone.amountCents,
      state: milestone.state,
      attemptsUsed: milestone.attemptsUsed,
      reviewDueAt: milestone.reviewDueAt,
    },
    milestoneCount: count,
    criteria: criteriaRows.map((check) => ({
      id: check.id,
      key: check.key,
      description: check.description,
      testPlan: check.testPlan,
      kind: check.kind,
      category: check.category,
      shareCents: check.shareCents,
    })),
    submission: submission
      ? {
          id: submission.id,
          attempt: submission.attempt,
          url: submission.url,
          repoUrl: submission.repoUrl,
          status: submission.status,
          currentCriterionId: submission.currentCriterionId,
          progressNote: submission.progressNote,
          replayUrl: submission.replayUrl,
          createdAt: submission.createdAt,
          finishedAt: submission.finishedAt,
        }
      : null,
    verdicts: verdictRows.map((verdict) => ({
      id: verdict.id,
      criterionId: verdict.criterionId,
      source: verdict.source,
      verdict: verdict.verdict,
      summary: verdict.summary,
    })),
    evidence: evidenceRows.map((item) => ({ ...item, hasImage: Boolean(item.hasImage) })),
    payments: paymentRows.map((payment) => ({
      type: payment.type,
      status: payment.status,
      amountCents: payment.amountCents,
      at: payment.updatedAt,
    })),
  };
}
