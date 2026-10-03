import type Anthropic from '@anthropic-ai/sdk';
import { asc, eq } from 'drizzle-orm';
import { insertVersion } from '../db/queries/contract';
import { criteria, type Db } from '../db/schema';
import type { CriterionFields } from '../domain/criteria';
import type { MilestoneState } from '../domain/milestone-state';
import type { AiVerdict } from '../domain/verification';
import { setupMilestone, type MilestoneFixture } from '../payments/testing';
import type { BrowserTools } from './browser';

export interface VerificationFixture extends MilestoneFixture {
  criteria: Array<CriterionFields & { id: string }>;
}

const DEFAULT_CHECKS: Array<Omit<CriterionFields, 'key'>> = [
  { description: 'The contact form sends a message', testPlan: 'Fill it in and press Send; a confirmation appears.', kind: 'machine', category: 'function', shareCents: 20000 },
  { description: 'The page works at phone width', testPlan: 'At 390 pixels wide nothing overflows.', kind: 'machine', category: 'responsive', shareCents: 15000 },
  { description: 'The page loads in under 3 seconds', testPlan: 'Three fresh loads; the middle one is under 3 seconds.', kind: 'machine', category: 'performance', shareCents: 15000 },
  { description: 'The page matches the look of the homepage', testPlan: 'The client compares the pages.', kind: 'human', category: null, shareCents: 10000 },
];

/** A 600.00 milestone in the given state with a signed list of checks and an active hold. */
export async function setupVerification(
  db: Db,
  options: { state: MilestoneState; checks?: Array<Omit<CriterionFields, 'key'>>; attemptsUsed?: number },
): Promise<VerificationFixture> {
  const fixture = await setupMilestone(db, {
    state: options.state,
    milestone: { attemptsUsed: options.attemptsUsed ?? 0, submittedFrom: options.state === 'verifying' ? 'funded' : null },
  });
  const checks = options.checks ?? DEFAULT_CHECKS;
  const versionId = await insertVersion(
    db,
    { milestoneId: fixture.milestoneId, number: 1, authorId: null, reason: '' },
    checks.map((check) => ({ ...check, key: crypto.randomUUID() })),
  );
  const rows = await db.select().from(criteria).where(eq(criteria.versionId, versionId)).orderBy(asc(criteria.position));
  return {
    ...fixture,
    criteria: rows.map((row) => ({
      id: row.id,
      key: row.key,
      description: row.description,
      testPlan: row.testPlan,
      kind: row.kind,
      category: row.category,
      shareCents: row.shareCents,
    })),
  };
}

/** A browser that answers every call from memory and records what it was asked. */
export function fakeBrowser(options: { status?: number | null; failOn?: string } = {}): BrowserTools & { calls: string[] } {
  const calls: string[] = [];
  const act = (name: string) => {
    calls.push(name);
    if (options.failOn === name) throw new Error(`${name} failed`);
  };
  return {
    calls,
    async open(url) {
      act('open');
      return { status: options.status === undefined ? 200 : options.status, finalUrl: url, title: 'Contact', error: options.status === null ? 'net::ERR_NAME_NOT_RESOLVED' : undefined };
    },
    async click(target) {
      act('click');
      return `Clicked "${target}".`;
    },
    async type(target, text) {
      act('type');
      return `Typed ${text.length} characters into "${target}".`;
    },
    async setViewport() {
      act('setViewport');
    },
    async screenshot() {
      act('screenshot');
      return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    },
    async pageText() {
      act('pageText');
      return 'Get in touch. Opening hours: Monday to Sunday, 7am to 6pm.';
    },
    consoleErrors() {
      act('consoleErrors');
      return [];
    },
    async loadTimes() {
      act('loadTimes');
      return [2100, 2300, 2200];
    },
    async checkLinks() {
      act('checkLinks');
      return [{ url: 'https://site.example/menu', status: 200 }];
    },
    async accessibility() {
      act('accessibility');
      return { score: 96, violations: [] };
    },
    async close() {
      act('close');
      return { replayUrl: 'https://replay.example/1' };
    },
  };
}

let replyCounter = 0;

/** A Claude reply made of the given content blocks. */
export function toolReply(...blocks: Array<Anthropic.ContentBlock>): Anthropic.Message {
  return {
    id: `msg_${++replyCounter}`,
    type: 'message',
    role: 'assistant',
    model: 'test',
    content: blocks,
    stop_reason: blocks.some((block) => block.type === 'tool_use') ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20 },
  } as unknown as Anthropic.Message;
}

export function toolUse(name: string, input: Record<string, unknown>): Anthropic.ToolUseBlock {
  return { type: 'tool_use', id: `tool_${++replyCounter}`, name, input } as Anthropic.ToolUseBlock;
}

/**
 * A tester that runs one tool of each kind, then records the next verdict queued for the check it was asked about.
 * `plan` maps a check's description to the verdicts to give on successive runs.
 */
export function scriptedTester(plan: Record<string, AiVerdict[]>) {
  const asked: string[] = [];
  const createMessage = async (params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> => {
    const briefing = String(params.messages[0].content);
    const description = Object.keys(plan).find((text) => briefing.includes(text));
    if (!description) throw new Error(`No verdicts queued for: ${briefing.slice(0, 80)}`);

    const answered = params.messages.some(
      (message) => Array.isArray(message.content) && message.content.some((part) => part.type === 'tool_result'),
    );
    if (!answered) {
      asked.push(description);
      return toolReply(
        toolUse('open_page', { url: 'https://site.example' }),
        toolUse('type_text', { target: 'Name', text: 'Test' }),
        toolUse('set_viewport', { width: 390, height: 844 }),
        toolUse('measure_load_times', { url: 'https://site.example', runs: 3 }),
        toolUse('read_page_text', {}),
      );
    }
    const verdict = plan[description].shift();
    if (!verdict) throw new Error(`Ran out of verdicts for ${description}`);
    return toolReply(toolUse('record_verdict', { verdict, summary: `Opened the page and the check ${verdict === 'pass' ? 'passed' : verdict === 'fail' ? 'failed' : 'was unclear'}.` }));
  };
  return { createMessage, asked };
}
