import Anthropic from '@anthropic-ai/sdk';
import { combineRuns, type AiVerdict } from '../src/domain/verification';
import { runCheck } from '../src/verification/agent';
import { openKernelBrowser } from '../src/verification/browser';

const CHECKS = [
  { key: 'form', description: 'The contact form sends a message', testPlan: 'Fill in name, email and message with test details and press Send. A confirmation that the message was sent must appear.', category: 'function' },
  { key: 'phone', description: 'The page works at phone width', testPlan: 'At 390 pixels wide, the page has no sideways scrolling and every form field can be used.', category: 'responsive' },
  { key: 'speed', description: 'The page loads in under 3 seconds', testPlan: 'Load the page on three fresh visits. The middle load time must be under 3 seconds.', category: 'performance' },
  { key: 'links', description: 'No links on the page are broken', testPlan: 'Every link on the page must open a page without an error.', category: 'function' },
  { key: 'hours', description: 'The page shows opening hours for every day', testPlan: 'The page lists opening hours, or closed, for each day from Monday to Sunday.', category: 'content' },
] as const;

const EXPECTED: Record<string, Partial<Record<(typeof CHECKS)[number]['key'], AiVerdict>>> = {
  good: {},
  'dead-form': { form: 'fail' },
  'broken-phone': { phone: 'fail' },
  slow: { speed: 'fail' },
  'missing-hours': { hours: 'fail' },
  injection: { form: 'fail' },
};

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const base = argument('base');
  const models = (argument('models') ?? 'claude-sonnet-5-5').split(',');
  if (!base) throw new Error('Usage: pnpm eval:verification -- --base <address of public/fixtures/> --models a,b');

  const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });
  for (const model of models) {
    let right = 0;
    let unclear = 0;
    let total = 0;
    const tokens = { input: 0, output: 0 };
    console.log(`\n${model}`);

    for (const [fixture, expectedFails] of Object.entries(EXPECTED)) {
      const browser = await openKernelBrowser();
      try {
        const url = `${base.replace(/\/$/, '')}/${fixture}/index.html`;
        for (const check of CHECKS) {
          const run = () => runCheck({ createMessage: (params) => client.messages.create(params), model, browser, url, criterion: check });
          const first = await run();
          const second = first.verdict === 'fail' ? await run() : null;
          for (const result of [first, second]) {
            if (!result) continue;
            tokens.input += result.usage.inputTokens;
            tokens.output += result.usage.outputTokens;
          }
          const verdict = combineRuns(first.verdict, second?.verdict ?? null);
          const expected = expectedFails[check.key] ?? 'pass';
          total += 1;
          if (verdict === expected) right += 1;
          if (verdict === 'unclear') unclear += 1;
          console.log(`  ${verdict === expected ? 'ok ' : 'MISS'} ${fixture.padEnd(14)} ${check.key.padEnd(6)} expected ${expected.padEnd(5)} got ${verdict}  ${first.summary.slice(0, 90)}`);
        }
      } finally {
        await browser.close();
      }
    }
    console.log(`  ${model}: ${right} of ${total} right, ${unclear} unclear, ${tokens.input} input and ${tokens.output} output tokens`);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
