import { describe, expect, it } from 'vitest';
import type { CriterionFields } from '../domain/criteria';
import { draftCriteria, rewriteCriteria, type StructuredModel } from './drafter';

const milestone = {
  projectTitle: "Chen's Bakery website",
  title: 'Contact page',
  brief: 'A contact page with a form that emails the bakery.',
  amountCents: 60000,
};

function answering(...answers: unknown[]): StructuredModel & { requests: Array<{ system: string; user: string }> } {
  const requests: Array<{ system: string; user: string }> = [];
  return {
    requests,
    async generate(request) {
      requests.push(request);
      const answer = answers.shift();
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

const item = (over: Record<string, unknown> = {}) => ({
  description: 'The form sends a message',
  kind: 'machine',
  category: 'function',
  test_plan: 'Fill in every field, press Send, and see a confirmation.',
  weight: 3,
  ...over,
});

const good = {
  criteria: [
    item(),
    item({ description: 'Works at phone width', category: 'responsive', weight: 2 }),
    item({ description: 'Matches the homepage', kind: 'human', category: 'none', weight: 1 }),
  ],
};

describe('draftCriteria', () => {
  it('turns the answer into checks whose shares total the milestone amount', async () => {
    const model = answering(good);
    expect(await draftCriteria(model, milestone)).toEqual([
      { description: 'The form sends a message', testPlan: 'Fill in every field, press Send, and see a confirmation.', kind: 'machine', category: 'function', shareCents: 30000 },
      { description: 'Works at phone width', testPlan: 'Fill in every field, press Send, and see a confirmation.', kind: 'machine', category: 'responsive', shareCents: 20000 },
      { description: 'Matches the homepage', testPlan: 'Fill in every field, press Send, and see a confirmation.', kind: 'human', category: null, shareCents: 10000 },
    ]);
    expect(model.requests[0].user).toContain('Contact page');
    expect(model.requests[0].user).toContain('$600.00');
    expect(model.requests[0].user).toContain('A contact page with a form that emails the bakery.');
  });

  it('asks once more when the first answer is unusable', async () => {
    const model = answering({ criteria: [item({ weight: 0 })] }, good);
    expect(await draftCriteria(model, milestone)).toHaveLength(3);
    expect(model.requests).toHaveLength(2);
  });

  it('asks once more when the model call itself fails', async () => {
    const model = answering(new Error('overloaded'), good);
    expect(await draftCriteria(model, milestone)).toHaveLength(3);
  });

  it('gives up after a second unusable answer', async () => {
    const model = answering({ criteria: 'none' }, { criteria: [] });
    await expect(draftCriteria(model, milestone)).rejects.toThrow();
    expect(model.requests).toHaveLength(2);
  });

  it.each([
    ['an unknown kind', item({ kind: 'robot' })],
    ['an automatic check with no category', item({ category: 'none' })],
    ['a blank description', item({ description: ' ' })],
    ['a missing test', item({ test_plan: '' })],
    ['a weight above ten', item({ weight: 11 })],
    ['a fractional weight', item({ weight: 1.5 })],
  ])('rejects %s', async (_label, bad) => {
    const model = answering({ criteria: [bad] }, { criteria: [bad] });
    await expect(draftCriteria(model, milestone)).rejects.toThrow();
  });
});

describe('rewriteCriteria', () => {
  const current: CriterionFields[] = [
    { key: 'key-form', description: 'The form sends a message', testPlan: 'Press Send.', kind: 'machine', category: 'function', shareCents: 30000 },
    { key: 'key-speed', description: 'Loads in under 3 seconds', testPlan: 'Measure a fresh visit.', kind: 'machine', category: 'performance', shareCents: 20000 },
    { key: 'key-look', description: 'Matches the homepage', testPlan: 'The client compares.', kind: 'human', category: null, shareCents: 10000 },
  ];
  const input = { ...milestone, current, request: 'Add a map check and allow 4 seconds.' };

  it('keeps the key of a check it kept or changed, and gives a new check a new key', async () => {
    const model = answering({
      criteria: [
        item({ replaces: 'c1', weight: 250 }),
        item({ replaces: 'c2', description: 'Loads in under 4 seconds', category: 'performance', weight: 150 }),
        item({ replaces: 'new', description: 'A map shows the shop', category: 'content', weight: 100 }),
        item({ replaces: 'c3', description: 'Matches the homepage', kind: 'human', category: 'none', weight: 100 }),
      ],
    });
    const result = await rewriteCriteria(model, input);

    expect(result.map((check) => check.key).filter((key) => key.startsWith('key-'))).toEqual(['key-form', 'key-speed', 'key-look']);
    expect(result[2].key).not.toBe('');
    expect(result.map((check) => check.shareCents)).toEqual([25000, 15000, 10000, 10000]);
    expect(result[1].description).toBe('Loads in under 4 seconds');
  });

  it('shows the model the current checks with their ids and the request', async () => {
    const model = answering({ criteria: [item({ replaces: 'c1', weight: 600 })] });
    await rewriteCriteria(model, input);
    expect(model.requests[0].user).toContain('c2 | machine, performance | $200.00 | Loads in under 3 seconds | Measure a fresh visit.');
    expect(model.requests[0].user).toContain('Add a map check and allow 4 seconds.');
  });

  it('treats a repeated or unknown id as a new check', async () => {
    const model = answering({
      criteria: [item({ replaces: 'c1', weight: 300 }), item({ replaces: 'c1', weight: 200 }), item({ replaces: 'c9', weight: 100 })],
    });
    const keys = (await rewriteCriteria(model, input)).map((check) => check.key);
    expect(keys[0]).toBe('key-form');
    expect(new Set(keys).size).toBe(3);
    expect(keys.filter((key) => key.startsWith('key-'))).toEqual(['key-form']);
  });

  it('keeps the exact dollar shares the model gave when they total the milestone amount', async () => {
    const model = answering({
      criteria: [item({ replaces: 'c1', weight: 271 }), item({ replaces: 'c2', weight: 287 }), item({ replaces: 'c3', weight: 42 })],
    });
    expect((await rewriteCriteria(model, input)).map((check) => check.shareCents)).toEqual([27100, 28700, 4200]);
  });

  it('scales the shares in proportion when they do not total the milestone amount', async () => {
    const model = answering({ criteria: [item({ replaces: 'c1', weight: 100 }), item({ replaces: 'c2', weight: 100 }), item({ replaces: 'c3', weight: 100 })] });
    expect((await rewriteCriteria(model, input)).map((check) => check.shareCents)).toEqual([20000, 20000, 20000]);
  });
});
