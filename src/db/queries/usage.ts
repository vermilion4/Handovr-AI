import { and, count, eq, gte, sql } from 'drizzle-orm';
import { allowance, startOfDay, type AiKind, type Limits } from '../../domain/usage';
import { aiUsage, type Db } from '../schema';

/** Checks today's limits and, when allowed, records the use. */
export async function takeAllowance(
  db: Db,
  input: { userId: string; kind: AiKind; now: Date; limits: Limits },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const since = startOfDay(input.now);
  return db.transaction(async (tx) => {
    // One request at a time counts and records, so requests arriving together cannot all slip under the limit.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('handovr_ai_usage'))`);
    const [{ mine }] = await tx
      .select({ mine: count() })
      .from(aiUsage)
      .where(and(eq(aiUsage.userId, input.userId), eq(aiUsage.kind, input.kind), gte(aiUsage.createdAt, since)));
    const [{ all }] = await tx.select({ all: count() }).from(aiUsage).where(gte(aiUsage.createdAt, since));
    const result = allowance({ kind: input.kind, usedByUser: Number(mine), usedToday: Number(all), limits: input.limits, now: input.now });
    if (result.ok) await tx.insert(aiUsage).values({ userId: input.userId, kind: input.kind, createdAt: input.now });
    return result;
  });
}
