import { beforeEach, describe, expect, it } from 'vitest';
import { limitsFrom } from '../../domain/usage';
import { aiUsage, users, type Db } from '../schema';
import { createTestDb } from '../test-db';
import { takeAllowance } from './usage';

let db: Db;
let userId: string;
const limits = { ...limitsFrom({}), perUser: { draft: 8, rewrite: 20, verify: 2 } };

beforeEach(async () => {
  db = await createTestDb();
  [{ id: userId }] = await db.insert(users).values({ name: 'Maya Chen', email: 'maya@example.com', role: 'client' }).returning({ id: users.id });
});

describe('takeAllowance', () => {
  it("records each use and counts only today's", async () => {
    await db.insert(aiUsage).values({ userId, kind: 'verify', createdAt: new Date('2026-11-19T23:00:00Z') });
    const now = new Date('2026-11-20T10:00:00Z');
    expect(await takeAllowance(db, { userId, kind: 'verify', now, limits })).toEqual({ ok: true });
    expect(await takeAllowance(db, { userId, kind: 'verify', now, limits })).toEqual({ ok: true });
    expect((await takeAllowance(db, { userId, kind: 'verify', now, limits })).ok).toBe(false);
    expect(await takeAllowance(db, { userId, kind: 'rewrite', now, limits })).toEqual({ ok: true });
    expect(await db.select().from(aiUsage)).toHaveLength(4);
  });

  it('lets only the allowed number through when requests arrive together', async () => {
    const now = new Date('2026-11-20T10:00:00Z');
    const results = await Promise.all(Array.from({ length: 6 }, () => takeAllowance(db, { userId, kind: 'verify', now, limits })));
    expect(results.filter((result) => result.ok)).toHaveLength(2);
    expect(await db.select().from(aiUsage)).toHaveLength(2);
  });

  it("counts everyone's use against the overall limit", async () => {
    const [{ id: otherId }] = await db.insert(users).values({ name: 'Tomás Rivera', email: 'tomas@example.com', role: 'freelancer' }).returning({ id: users.id });
    const tight = { ...limits, total: 1 };
    const now = new Date('2026-11-20T10:00:00Z');
    expect(await takeAllowance(db, { userId: otherId, kind: 'draft', now, limits: tight })).toEqual({ ok: true });
    expect(await takeAllowance(db, { userId, kind: 'draft', now, limits: tight })).toMatchObject({ ok: false });
  });
});
