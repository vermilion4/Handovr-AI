import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { evidence, milestones, submissions, verdicts, type Db } from '../db/schema';
import { combineRuns, itemsForClient, verificationOutcome, type AiVerdict } from '../domain/verification';
import { applyEvent } from '../payments/milestone-events';
import { runCheck, type CheckRun, type CreateMessage, type EvidenceItem } from './agent';
import type { BrowserTools } from './browser';
import { checkOutcomes, signedChecks } from './outcomes';

export const MAX_RUN_TRIES = 2;
const LEFT_FOR_CLIENT = 'The test run could not finish, so this check is left for the client.';

export interface VerificationDeps {
  openBrowser(): Promise<BrowserTools>;
  createMessage: CreateMessage;
  model: string;
  now(): Date;
  reviewWindowSeconds: number;
  onRelease(): Promise<void>;
}

export type RunResult = 'skipped' | 'paused' | 'unreachable' | 'passed' | 'failed' | 'retry';

type Submission = typeof submissions.$inferSelect;

/** Another run has taken this submission over, so this one must stop without changing anything. */
class LostClaim extends Error {}
/** The milestone is no longer being tested, for example after a funding problem. */
class Paused extends Error {}

/** Matches the submission only while this run still holds it. */
const held = (submission: Submission) =>
  and(eq(submissions.id, submission.id), eq(submissions.status, 'running'), eq(submissions.tries, submission.tries));

async function touch(db: Db, deps: VerificationDeps, submission: Submission, patch: Partial<typeof submissions.$inferInsert> = {}) {
  const [row] = await db
    .update(submissions)
    .set({ ...patch, heartbeatAt: deps.now() })
    .where(held(submission))
    .returning({ id: submissions.id });
  if (!row) throw new LostClaim();
}

async function milestoneState(db: Db, milestoneId: string) {
  const [row] = await db.select({ state: milestones.state }).from(milestones).where(eq(milestones.id, milestoneId));
  return row?.state;
}

async function saveVerdict(
  db: Db,
  submissionId: string,
  criterionId: string,
  verdict: AiVerdict,
  summary: string,
  items: EvidenceItem[],
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(verdicts)
      .values({ submissionId, criterionId, source: 'ai', verdict, summary })
      .onConflictDoNothing()
      .returning({ id: verdicts.id });
    if (!row || items.length === 0) return;
    await tx.insert(evidence).values(
      items.map((item) => ({ submissionId, verdictId: row.id, kind: item.kind, caption: item.caption, text: item.text, image: item.image })),
    );
  });
}

async function captureOverview(db: Db, browser: BrowserTools, submissionId: string): Promise<void> {
  const existing = await db
    .select({ id: evidence.id })
    .from(evidence)
    .where(and(eq(evidence.submissionId, submissionId), isNull(evidence.verdictId)))
    .limit(1);
  if (existing.length > 0) return;

  const desktop = await browser.screenshot();
  await browser.setViewport(390, 844);
  const phone = await browser.screenshot();
  await browser.setViewport(1280, 800);
  await db.insert(evidence).values([
    { submissionId, kind: 'screenshot', caption: 'Desktop, as first opened', image: desktop },
    { submissionId, kind: 'screenshot', caption: 'Phone, 390 pixels wide', image: phone },
  ]);
}

async function markUnreachable(db: Db, deps: VerificationDeps, submission: Submission, reason: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(submissions)
      .set({ status: 'unreachable', finishedAt: deps.now(), currentCriterionId: null, progressNote: `The site could not be opened (${reason}).` })
      .where(held(submission))
      .returning({ id: submissions.id });
    if (!row) throw new LostClaim();
    const applied = await applyEvent(tx, submission.milestoneId, { type: 'site_unreachable' }, { now: deps.now() });
    if (!applied.ok) throw new Paused();
  });
}

/** Records the result and moves the milestone on, all or nothing. */
async function finish(db: Db, deps: VerificationDeps, submission: Submission): Promise<'passed' | 'failed'> {
  const now = deps.now();
  const { result, released } = await db.transaction(async (tx) => {
    const [milestone] = await tx.select().from(milestones).where(eq(milestones.id, submission.milestoneId)).for('update');
    if (milestone.state !== 'verifying') throw new Paused();

    const checks = await signedChecks(tx, submission.milestoneId);
    for (const outcome of await checkOutcomes(tx, submission.milestoneId, submission.id)) {
      const check = checks.find((candidate) => candidate.id === outcome.criterionId)!;
      if (check.kind === 'machine' && outcome.verdict === null) {
        await tx.insert(verdicts).values({ submissionId: submission.id, criterionId: check.id, source: 'ai', verdict: 'unclear', summary: LEFT_FOR_CLIENT }).onConflictDoNothing();
      }
    }

    const outcomes = await checkOutcomes(tx, submission.milestoneId, submission.id);
    const result = verificationOutcome(outcomes);
    const [row] = await tx
      .update(submissions)
      .set({ status: result, finishedAt: now, currentCriterionId: null, progressNote: '', heartbeatAt: now })
      .where(held(submission))
      .returning({ id: submissions.id });
    if (!row) throw new LostClaim();

    const applied = await applyEvent(tx, submission.milestoneId, { type: result === 'passed' ? 'verification_passed' : 'verification_failed' }, { now });
    if (!applied.ok) throw new Paused();
    if (result === 'failed') return { result, released: false };

    if (itemsForClient(outcomes).length === 0) {
      const approved = await applyEvent(tx, submission.milestoneId, { type: 'client_approved' }, { now });
      return { result, released: approved.ok };
    }
    await tx
      .update(milestones)
      .set({ reviewDueAt: new Date(now.getTime() + deps.reviewWindowSeconds * 1000) })
      .where(eq(milestones.id, submission.milestoneId));
    return { result, released: false };
  });

  if (released) await deps.onRelease();
  return result;
}

async function pause(db: Db, submission: Submission): Promise<void> {
  // A pause is not a crash, so the try it used is given back.
  await db
    .update(submissions)
    .set({ status: 'queued', tries: submission.tries - 1, currentCriterionId: null, progressNote: 'Testing is paused until the milestone is funded again.' })
    .where(held(submission));
}

export async function runVerification(db: Db, deps: VerificationDeps, submissionId: string): Promise<RunResult> {
  const now = deps.now();
  const [submission] = await db
    .update(submissions)
    .set({ status: 'running', tries: sql`${submissions.tries} + 1`, startedAt: now, heartbeatAt: now, progressNote: 'Starting the browser' })
    .where(
      and(
        eq(submissions.id, submissionId),
        eq(submissions.status, 'queued'),
        eq(submissions.simulated, false),
        inArray(submissions.milestoneId, db.select({ id: milestones.id }).from(milestones).where(eq(milestones.state, 'verifying'))),
      ),
    )
    .returning();
  if (!submission) return 'skipped';

  let browser: BrowserTools | null = null;
  try {
    if (submission.tries <= MAX_RUN_TRIES) {
      const outcomes = await checkOutcomes(db, submission.milestoneId, submission.id);
      const open = (await signedChecks(db, submission.milestoneId)).filter(
        (check) => check.kind === 'machine' && outcomes.find((outcome) => outcome.criterionId === check.id)?.verdict === null,
      );

      if (open.length > 0) {
        browser = await deps.openBrowser();
        const opened = await browser.open(submission.url);
        if (!opened.status || opened.status >= 400) {
          await markUnreachable(db, deps, submission, opened.error ?? `HTTP ${opened.status}`);
          return 'unreachable';
        }
        await captureOverview(db, browser, submission.id);

        for (const check of open) {
          if ((await milestoneState(db, submission.milestoneId)) !== 'verifying') throw new Paused();
          const run = async (note: string) => {
            await touch(db, deps, submission, { currentCriterionId: check.id, progressNote: note });
            return runCheck({
              createMessage: deps.createMessage,
              model: deps.model,
              browser: browser!,
              url: submission.url,
              criterion: check,
              onTurn: () => touch(db, deps, submission),
            });
          };
          const first = await run(`Testing: ${check.description}`);
          const second: CheckRun | null = first.verdict === 'fail' ? await run(`Testing again: ${check.description}`) : null;
          const summary = second ? `${first.summary}\n\nSecond run: ${second.summary}` : first.summary;
          await saveVerdict(db, submission.id, check.id, combineRuns(first.verdict, second?.verdict ?? null), summary, [
            ...first.evidence,
            ...(second?.evidence ?? []),
          ]);
        }
      }
    }
    return await finish(db, deps, submission);
  } catch (error) {
    if (error instanceof LostClaim) return 'skipped';
    if (error instanceof Paused) {
      await pause(db, submission);
      return 'paused';
    }
    console.error(`The verification run for submission ${submission.id} stopped`, error);
    if (submission.tries < MAX_RUN_TRIES) {
      await db
        .update(submissions)
        .set({ status: 'queued', currentCriterionId: null, progressNote: 'The test run stopped and will start again.' })
        .where(held(submission));
      return 'retry';
    }
    return finishAfterLastTry(db, deps, submission);
  } finally {
    if (browser) {
      const closed = await browser.close().catch(() => ({ replayUrl: null }));
      if (closed.replayUrl) await db.update(submissions).set({ replayUrl: closed.replayUrl }).where(eq(submissions.id, submission.id));
    }
  }
}

/** After the last try has crashed, the unfinished checks are left to the client. */
async function finishAfterLastTry(db: Db, deps: VerificationDeps, submission: Submission): Promise<RunResult> {
  try {
    return await finish(db, deps, submission);
  } catch (error) {
    if (error instanceof LostClaim) return 'skipped';
    if (error instanceof Paused) {
      await pause(db, submission);
      return 'paused';
    }
    throw error;
  }
}
