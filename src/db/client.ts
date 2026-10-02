import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { schema, type Db } from './schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local.');

// Reuse one connection across hot reloads in development.
const globalForDb = globalThis as unknown as { handovrSql?: ReturnType<typeof postgres> };
const sql = globalForDb.handovrSql ?? postgres(url);
if (process.env.NODE_ENV !== 'production') globalForDb.handovrSql = sql;

export const db: Db = drizzle({ client: sql, schema });
