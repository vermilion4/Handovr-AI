import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { evidence, milestones, paymentEvents, submissions, verdicts, type Db } from '../db/schema';
import { createTestDb } from '../db/test-db';
import type { BrowserTools } from './browser';
import { applyEvent } from '../payments/milestone-events';
import { runVerification, type VerificationDeps } from './run';
import { submitWork } from './submissions';
import { fakeBrowser, scriptedTester, setupVerification, type VerificationFixture } from './testing';

const now = new Date('2026-10-12T12:00:00Z');
let db: Db;
let fixture: VerificationFixture;
let submissionId: string;

const [FORM, PHONE, SPEED] = [
  'The contact form sends a message',
  'The page works at phone width',
  'The page loads in under 3 seconds',
];

beforeEach(async () => {
  db = await createTestDb();
  fixture = await setupVerification(db, { state: 'funded' });
  const result = await submitWork(db, { milestoneId: fixture.milestoneId, userId: fixture.freelancerId, url: 'https://chens.example/contact', repoUrl: '', now });
  if (!result.ok) throw new Error(result.reason);
  submissionId = result.submissionId;
});

function deps(plan: Record<string, Array<'pass' | 'fail' | 'unclear'>>, browser: BrowserTools = fakeBrowser()) {
  const tester = scriptedTester(plan);
  let released = 0;
  const value: VerificationDeps = {
    openBrowser: async () => browser,
    createMessage: tester.createMessage,
    model: 'test-model',
    now: () => now,
    reviewWindowSeconds: 3600,
    onRelease: async () => {
      released += 1;
    },
  };
  return { value, tester, released: () => released };
}

const stateNow = async () => (await db.select().from(milestones).where(eq(milestones.id, fixture.milestoneId)))[0];
const submissionNow = async () => (await db.select().from(submissions).where(eq(submissions.id, submissionId)))[0];
const aiVerdicts = async () =>
  Object.fromEntries(
    (await db.select().from(verdicts).where(eq(verdicts.submissionId, submissionId))).map((row) => [
      fixture.criteria.find((check) => check.id === row.criterionId)!.description,
      row.verdict,
    ]),
  );

describe('runVerification', () => {
  it('sends a passing submission to the client with a review deadline and evidence', async () => {
    const run = deps({ [FORM]: ['pass'], [PHONE]: ['pass'], [SPEED]: ['pass'] });
    expect(await runVerification(db, run.value, submissionId)).toBe('passed');

    expect(await aiVerdicts()).toEqual({ [FORM]: 'pass', [PHONE]: 'pass', [SPEED]: 'pass' });
    expect(await stateNow()).toMatchObject({ state: 'client_review', attemptsUsed: 1, reviewDueAt: new Date('2026-10-12T13:00:00Z') });
    expect(await submissionNow()).toMatchObject({ status: 'passed', tries: 1, finishedAt: now, currentCriterionId: null, replayUrl: 'https://replay.example/1' });

    const overview = await db.select().from(evidence).where(eq(evidence.submissionId, submissionId));
    expect(overview.filter((item) => item.verdictId === null).map((item) => item.caption)).toEqual([
      'Desktop, as first opened',
      'Phone, 390 pixels wide',
    ]);
    expect(run.released()).toBe(0);
  });

  it('runs a failed check a second time and sends the work back when both runs fail', async () => {
    const run = deps({ [FORM]: ['fail', 'fail'], [PHONE]: ['pass'], [SPEED]: ['pass'] });
    expect(await runVerification(db, run.value, submissionId)).toBe('failed');
    expect(run.tester.asked.filter((asked) => asked === FORM)).toHaveLength(2);
    expect((await aiVerdicts())[FORM]).toBe('fail');
    expect(await stateNow()).toMatchObject({ state: 'revision', attemptsUsed: 1 });
  });

  it('leaves a check to the client when its two runs disagree', async () => {
    const run = deps({ [FORM]: ['fail', 'pass'], [PHONE]: ['pass'], [SPEED]: ['pass'] });
    expect(await runVerification(db, run.value, submissionId)).toBe('passed');
    expect((await aiVerdicts())[FORM]).toBe('unclear');
    const [row] = (await db.select().from(verdicts)).filter((verdict) => verdict.verdict === 'unclear');
    expect(row.summary).toContain('Second run:');
  });

  it('releases straight away when every check is automatic and passed', async () => {
    fixture = await setupVerification(db, {
      state: 'funded',
      checks: [
        { description: FORM, testPlan: 'Send it.', kind: 'machine', category: 'function', shareCents: 30000 },
        { description: PHONE, testPlan: 'At 390.', kind: 'machine', category: 'responsive', shareCents: 30000 },
      ],
    });
    const result = await submitWork(db, { milestoneId: fixture.milestoneId, userId: fixture.freelancerId, url: 'https://chens.example', repoUrl: '', now });
    submissionId = result.ok ? result.submissionId : '';
    const run = deps({ [FORM]: ['pass'], [PHONE]: ['pass'] });

    expect(await runVerification(db, run.value, submissionId)).toBe('passed');
    expect((await stateNow()).state).toBe('releasing');
    expect(run.released()).toBe(1);
    expect((await db.select().from(paymentEvents).where(eq(paymentEvents.milestoneId, fixture.milestoneId))).map((row) => row.type)).toEqual([
      'capture',
      'payout',
    ]);
  });

  it('uses no attempt when the site cannot be opened', async () => {
    const run = deps({}, fakeBrowser({ status: null }));
    expect(await runVerification(db, run.value, submissionId)).toBe('unreachable');
    expect(await stateNow()).toMatchObject({ state: 'funded', attemptsUsed: 0 });
    expect((await submissionNow()).status).toBe('unreachable');
    expect((await submissionNow()).progressNote).toContain('ERR_NAME_NOT_RESOLVED');
  });

  it('counts an error page as unreachable', async () => {
    expect(await runVerification(db, deps({}, fakeBrowser({ status: 503 })).value, submissionId)).toBe('unreachable');
  });

  it('puts a crashed run back in the queue, then finishes only the checks still open', async () => {
    const crashing = deps({ [FORM]: ['pass'] });
    expect(await runVerification(db, crashing.value, submissionId)).toBe('retry');
    expect(await submissionNow()).toMatchObject({ status: 'queued', tries: 1 });
    expect(await aiVerdicts()).toEqual({ [FORM]: 'pass' });

    const second = deps({ [PHONE]: ['pass'], [SPEED]: ['pass'] });
    expect(await runVerification(db, second.value, submissionId)).toBe('passed');
    expect(second.tester.asked).toEqual([PHONE, SPEED]);
    expect(await aiVerdicts()).toEqual({ [FORM]: 'pass', [PHONE]: 'pass', [SPEED]: 'pass' });
  });

  it('sends the work back without using an attempt when the browser never works', async () => {
    const browserThatFails = (): BrowserTools => ({ ...fakeBrowser(), open: async () => { throw new Error('KERNEL is down'); } });
    const results = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      results.push(await runVerification(db, deps({}, browserThatFails()).value, submissionId));
    }
    expect(results).toEqual(['retry', 'unreachable']);
    expect(await aiVerdicts()).toEqual({ [FORM]: 'unclear', [PHONE]: 'unclear', [SPEED]: 'unclear' });
    expect(await stateNow()).toMatchObject({ state: 'funded', attemptsUsed: 0 });
    expect(await submissionNow()).toMatchObject({ status: 'unreachable' });
    expect((await submissionNow()).progressNote).toContain('could not complete any of the automatic checks');
  });

  it('sends the work back when the tester could not decide any automatic check', async () => {
    const run = deps({ [FORM]: ['unclear'], [PHONE]: ['unclear'], [SPEED]: ['unclear'] });
    expect(await runVerification(db, run.value, submissionId)).toBe('unreachable');
    expect(await stateNow()).toMatchObject({ state: 'funded', attemptsUsed: 0 });
  });

  it('still sends the work to the client when the tester decided at least one check', async () => {
    const run = deps({ [FORM]: ['unclear'], [PHONE]: ['pass'], [SPEED]: ['unclear'] });
    expect(await runVerification(db, run.value, submissionId)).toBe('passed');
    expect((await stateNow()).state).toBe('client_review');
  });

  it('does nothing for a submission that is not queued', async () => {
    await db.update(submissions).set({ status: 'running' }).where(eq(submissions.id, submissionId));
    expect(await runVerification(db, deps({}).value, submissionId)).toBe('skipped');
  });

  it('never runs a simulated submission', async () => {
    await db.update(submissions).set({ simulated: true }).where(eq(submissions.id, submissionId));
    expect(await runVerification(db, deps({}).value, submissionId)).toBe('skipped');
  });

  it('changes nothing when another run has taken the submission over', async () => {
    const run = deps({ [FORM]: ['pass'], [PHONE]: ['pass'], [SPEED]: ['pass'] });
    const original = run.value.createMessage;
    let takenOver = false;
    run.value.createMessage = async (params) => {
      if (!takenOver) {
        takenOver = true;
        await db.update(submissions).set({ tries: 2 }).where(eq(submissions.id, submissionId));
      }
      return original(params);
    };
    expect(await runVerification(db, run.value, submissionId)).toBe('skipped');
    expect((await stateNow()).state).toBe('verifying');
    expect(await submissionNow()).toMatchObject({ status: 'running', tries: 2 });
  });

  it('pauses when the milestone leaves testing, and finishes once funding is fixed', async () => {
    const run = deps({ [FORM]: ['pass'], [PHONE]: ['pass'], [SPEED]: ['pass'] });
    const original = run.value.createMessage;
    let broken = false;
    run.value.createMessage = async (params) => {
      if (!broken) {
        broken = true;
        await applyEvent(db, fixture.milestoneId, { type: 'hold_invalid' }, { now });
      }
      return original(params);
    };
    expect(await runVerification(db, run.value, submissionId)).toBe('paused');
    expect((await stateNow()).state).toBe('funding_problem');
    expect(await submissionNow()).toMatchObject({ status: 'queued', tries: 0 });

    expect(await runVerification(db, deps({}).value, submissionId)).toBe('skipped');

    await applyEvent(db, fixture.milestoneId, { type: 'hold_confirmed' }, { now });
    expect(await runVerification(db, run.value, submissionId)).toBe('passed');
    expect((await stateNow()).state).toBe('client_review');
  });

  it('keeps the run alive by recording when it last did something', async () => {
    await runVerification(db, deps({ [FORM]: ['pass'], [PHONE]: ['pass'], [SPEED]: ['pass'] }).value, submissionId);
    expect((await submissionNow()).heartbeatAt).toEqual(now);
  });
});
