import { isUuid } from './ids';
import { formatMoney } from './money';

export type CriterionKind = 'machine' | 'human';

export const CATEGORIES = ['function', 'content', 'responsive', 'performance', 'accessibility'] as const;
export type CriterionCategory = (typeof CATEGORIES)[number];

export interface CriterionFields {
  /** Stays the same across versions of a list, so a reworded check can be matched to its earlier wording. */
  key: string;
  description: string;
  testPlan: string;
  kind: CriterionKind;
  category: CriterionCategory | null;
  shareCents: number;
}

export type DraftedCriterion = Omit<CriterionFields, 'key'>;

export const MAX_CRITERIA = 12;
export const MAX_DESCRIPTION = 140;
export const MAX_TEST_PLAN = 600;

export function checkCriteriaList(amountCents: number, items: CriterionFields[]): string | null {
  if (items.length === 0) return 'A milestone needs at least one check.';
  if (items.length > MAX_CRITERIA) return `A milestone can have at most ${MAX_CRITERIA} checks.`;
  if (new Set(items.map((item) => item.key)).size !== items.length) {
    return 'Two checks share the same id. Reload the page and try again.';
  }

  for (const [index, item] of items.entries()) {
    const label = `Check ${index + 1}`;
    if (item.description.trim() === '') return `${label} needs a name.`;
    if (item.description.length > MAX_DESCRIPTION) return `${label}: keep the name under ${MAX_DESCRIPTION} characters.`;
    if (item.testPlan.trim() === '') return `${label} needs a line saying how it is checked.`;
    if (item.testPlan.length > MAX_TEST_PLAN) return `${label}: keep the test under ${MAX_TEST_PLAN} characters.`;
    if (item.kind !== 'machine' && item.kind !== 'human') return `${label} has an unknown type.`;
    if (item.kind === 'machine' && !CATEGORIES.includes(item.category as CriterionCategory)) {
      return `${label} is tested automatically, so it needs a test category.`;
    }
    if (item.kind === 'human' && item.category !== null) {
      return `${label} is decided by the client, so it cannot have a test category.`;
    }
    if (!Number.isInteger(item.shareCents) || item.shareCents <= 0) return `${label} needs a share above $0.00.`;
  }

  const total = items.reduce((sum, item) => sum + item.shareCents, 0);
  if (total !== amountCents) {
    return `Shares add up to ${formatMoney(total)}, but the milestone is ${formatMoney(amountCents)}.`;
  }
  return null;
}

export interface ListDiff {
  added: string[];
  changed: Record<string, CriterionFields>;
  removed: CriterionFields[];
  /** The earlier share, in cents, of each kept check whose share changed. */
  previousShares: Record<string, number>;
  rebalanced: boolean;
}

export function diffCriteria(previous: CriterionFields[], next: CriterionFields[]): ListDiff {
  const before = new Map(previous.map((item) => [item.key, item]));
  const nextKeys = new Set(next.map((item) => item.key));
  const diff: ListDiff = { added: [], changed: {}, removed: [], previousShares: {}, rebalanced: false };

  for (const item of next) {
    const old = before.get(item.key);
    if (!old) {
      diff.added.push(item.key);
      continue;
    }
    const reworded =
      old.description !== item.description ||
      old.testPlan !== item.testPlan ||
      old.kind !== item.kind ||
      old.category !== item.category;
    if (reworded) diff.changed[item.key] = old;
    if (old.shareCents !== item.shareCents) diff.previousShares[item.key] = old.shareCents;
  }

  diff.removed = previous.filter((item) => !nextKeys.has(item.key));
  diff.rebalanced = Object.keys(diff.previousShares).length > 0;
  return diff;
}

export function isEmptyDiff(diff: ListDiff): boolean {
  return (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    Object.keys(diff.changed).length === 0 &&
    !diff.rebalanced
  );
}

export function describeDiff(diff: ListDiff, next: CriterionFields[], amountCents: number): string[] {
  const lines: string[] = [];
  for (const item of next) {
    if (diff.changed[item.key]) lines.push(`Changed: ${item.description}`);
  }
  for (const item of next) {
    if (diff.added.includes(item.key)) lines.push(`New check: ${item.description}`);
  }
  for (const item of diff.removed) lines.push(`Removed: ${item.description}`);
  if (diff.rebalanced) lines.push(`Shares rebalanced to total ${formatMoney(amountCents)}`);
  return lines;
}

export function readCriteriaList(value: unknown): CriterionFields[] | null {
  if (!Array.isArray(value) || value.length > MAX_CRITERIA) return null;

  const items: CriterionFields[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const { key, description, testPlan, kind, category, shareCents } = entry as Record<string, unknown>;
    if (typeof key !== 'string' || !isUuid(key)) return null;
    if (typeof description !== 'string' || typeof testPlan !== 'string') return null;
    if (kind !== 'machine' && kind !== 'human') return null;
    if (category !== null && !CATEGORIES.includes(category as CriterionCategory)) return null;
    if (typeof shareCents !== 'number' || !Number.isFinite(shareCents)) return null;
    items.push({ key, description, testPlan, kind, category: category as CriterionCategory | null, shareCents });
  }
  return items;
}
