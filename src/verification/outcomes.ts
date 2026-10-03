import { and, asc, eq } from 'drizzle-orm';
import { latestVersion } from '../db/queries/contract';
import { criteria, verdicts, type Db } from '../db/schema';
import type { AiVerdict, CheckOutcome } from '../domain/verification';

export interface SignedCheck {
  id: string;
  description: string;
  testPlan: string;
  kind: 'machine' | 'human';
  category: string | null;
  shareCents: number;
}

/** The checks both people signed for the milestone. */
export async function signedChecks(db: Db, milestoneId: string): Promise<SignedCheck[]> {
  const version = await latestVersion(db, milestoneId);
  if (!version) return [];
  const rows = await db.select().from(criteria).where(eq(criteria.versionId, version.id)).orderBy(asc(criteria.position));
  return rows.map((row) => ({ id: row.id, description: row.description, testPlan: row.testPlan, kind: row.kind, category: row.category, shareCents: row.shareCents }));
}

export async function checkOutcomes(db: Db, milestoneId: string, submissionId: string): Promise<CheckOutcome[]> {
  const checks = await signedChecks(db, milestoneId);
  const rows = await db
    .select()
    .from(verdicts)
    .where(and(eq(verdicts.submissionId, submissionId), eq(verdicts.source, 'ai')));
  const byCheck = new Map(rows.map((row) => [row.criterionId, row.verdict as AiVerdict]));
  return checks.map((check) => ({ criterionId: check.id, kind: check.kind, verdict: byCheck.get(check.id) ?? null }));
}
