import { describe, expect, it } from 'vitest';
import {
  checkCriteriaList,
  describeDiff,
  diffCriteria,
  isEmptyDiff,
  readCriteriaList,
  type CriterionFields,
} from './criteria';

const check = (key: string, shareCents: number, over: Partial<CriterionFields> = {}): CriterionFields => ({
  key,
  description: `Check ${key}`,
  testPlan: 'Open the page and look.',
  kind: 'machine',
  category: 'function',
  shareCents,
  ...over,
});

const list = [check('a', 30000), check('b', 20000), check('c', 10000, { kind: 'human', category: null })];

describe('checkCriteriaList', () => {
  it('accepts a list whose shares total the milestone amount', () => {
    expect(checkCriteriaList(60000, list)).toBeNull();
  });

  it('refuses shares that do not total the amount, naming both figures', () => {
    expect(checkCriteriaList(60000, [check('a', 30000), check('b', 20000)])).toBe(
      'Shares add up to $500.00, but the milestone is $600.00.',
    );
  });

  it('refuses a share of zero, a negative share and a fraction of a cent', () => {
    for (const share of [0, -100, 10.5]) {
      expect(checkCriteriaList(60000, [check('a', share), check('b', 60000)])).toBe(
        'Check 1 needs a share above $0.00.',
      );
    }
  });

  it('refuses an empty list and a list that is too long', () => {
    expect(checkCriteriaList(60000, [])).toBe('A milestone needs at least one check.');
    const many = Array.from({ length: 13 }, (_, index) => check(`k${index}`, 100));
    expect(checkCriteriaList(1300, many)).toBe('A milestone can have at most 12 checks.');
  });

  it('refuses a blank name or a blank test', () => {
    expect(checkCriteriaList(60000, [check('a', 60000, { description: '  ' })])).toBe('Check 1 needs a name.');
    expect(checkCriteriaList(60000, [check('a', 60000, { testPlan: '' })])).toBe(
      'Check 1 needs a line saying how it is checked.',
    );
  });

  it('refuses an automatic check with no category and a client check with one', () => {
    expect(checkCriteriaList(60000, [check('a', 60000, { category: null })])).toBe(
      'Check 1 is tested automatically, so it needs a test category.',
    );
    expect(checkCriteriaList(60000, [check('a', 60000, { kind: 'human' })])).toBe(
      'Check 1 is decided by the client, so it cannot have a test category.',
    );
  });

  it('refuses two checks with the same key', () => {
    expect(checkCriteriaList(60000, [check('a', 30000), check('a', 30000)])).toBe(
      'Two checks share the same id. Reload the page and try again.',
    );
  });
});

describe('diffCriteria', () => {
  it('reports nothing when the lists match', () => {
    expect(isEmptyDiff(diffCriteria(list, list))).toBe(true);
  });

  it('marks a reworded check as changed and keeps its old fields', () => {
    const next = [check('a', 30000, { description: 'New wording' }), list[1], list[2]];
    const diff = diffCriteria(list, next);
    expect(diff.changed).toEqual({ a: list[0] });
    expect(diff.added).toEqual([]);
    expect(diff.rebalanced).toBe(false);
    expect(diff.previousShares).toEqual({});
  });

  it('marks added and removed checks', () => {
    const next = [list[0], list[1], check('d', 10000)];
    const diff = diffCriteria(list, next);
    expect(diff.added).toEqual(['d']);
    expect(diff.removed).toEqual([list[2]]);
  });

  it('reports a change of shares alone as a rebalance, not as changed checks', () => {
    const next = [check('a', 25000), check('b', 25000), list[2]];
    const diff = diffCriteria(list, next);
    expect(diff.changed).toEqual({});
    expect(diff.rebalanced).toBe(true);
    expect(diff.previousShares).toEqual({ a: 30000, b: 20000 });
    expect(isEmptyDiff(diff)).toBe(false);
  });
});

describe('describeDiff', () => {
  it('writes one line per change', () => {
    const next = [
      check('a', 25000, { description: 'Loads in 4 seconds' }),
      check('b', 20000),
      check('d', 15000, { description: 'A map shows the shop' }),
    ];
    expect(describeDiff(diffCriteria(list, next), next, 60000)).toEqual([
      'Changed: Loads in 4 seconds',
      'New check: A map shows the shop',
      'Removed: Check c',
      'Shares rebalanced to total $600.00',
    ]);
  });
});

describe('readCriteriaList', () => {
  const key = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
  const sent = { key, description: 'Loads', testPlan: 'Open it.', kind: 'machine', category: 'function', shareCents: 60000 };

  it('returns the checks when every field has the right type, dropping anything extra', () => {
    expect(readCriteriaList([{ ...sent, extra: 'ignored' }])).toEqual([sent]);
  });

  it('returns null for anything that is not a list of checks', () => {
    const bad = [
      null,
      'text',
      [sent, 'text'],
      [{ ...sent, key: 'not-a-uuid' }],
      [{ ...sent, description: 5 }],
      [{ ...sent, kind: 'robot' }],
      [{ ...sent, category: 'magic' }],
      [{ ...sent, shareCents: '600' }],
      Array.from({ length: 13 }, () => sent),
    ];
    for (const value of bad) expect(readCriteriaList(value)).toBeNull();
  });
});
