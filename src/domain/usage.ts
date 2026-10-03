export type AiKind = 'draft' | 'rewrite' | 'verify';

export interface Limits {
  perUser: Record<AiKind, number>;
  total: number;
}

const whole = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export function limitsFrom(env: Record<string, string | undefined>): Limits {
  return {
    perUser: { draft: whole(env.AI_LIMIT_DRAFT, 8), rewrite: whole(env.AI_LIMIT_REWRITE, 20), verify: whole(env.AI_LIMIT_VERIFY, 6) },
    total: whole(env.AI_LIMIT_TOTAL, 150),
  };
}

const NAMES: Record<AiKind, string> = { draft: 'check drafts', rewrite: 'rewrites', verify: 'test runs' };

export function startOfDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function allowance(input: {
  kind: AiKind;
  usedByUser: number;
  usedToday: number;
  limits: Limits;
  now: Date;
}): { ok: true } | { ok: false; message: string } {
  const hours = Math.ceil((startOfDay(input.now).getTime() + 24 * 60 * 60 * 1000 - input.now.getTime()) / (60 * 60 * 1000));
  const when = `Try again after midnight UTC, in ${hours === 1 ? '1 hour' : `${hours} hours`}.`;
  if (input.usedToday >= input.limits.total) return { ok: false, message: `Handovr has reached its AI limit for today. ${when}` };
  const mine = input.limits.perUser[input.kind];
  if (input.usedByUser >= mine) return { ok: false, message: `You have used today's ${mine} ${NAMES[input.kind]}. ${when}` };
  return { ok: true };
}
