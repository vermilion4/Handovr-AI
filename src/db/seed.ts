import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { criteria, criteriaVersions, milestones, projects, schema, signatures, users } from './schema';
import { seedDemo } from './seed-data';
import { assertSafeToSeed } from './seed-guard';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set.');

async function main(databaseUrl: string) {
  assertSafeToSeed(process.env);
  const sql = postgres(databaseUrl, { max: 1 });
  const db = drizzle({ client: sql, schema });

  // Empty the tables before loading the demo data.
  await db.delete(signatures);
  await db.delete(criteria);
  await db.delete(criteriaVersions);
  await db.delete(milestones);
  await db.delete(projects);
  await db.delete(users);
  await seedDemo(db);
  await sql.end();
  console.log('Demo data loaded.');
}

main(url).catch((error) => {
  console.error(error);
  process.exit(1);
});
