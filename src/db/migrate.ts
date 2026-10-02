import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set.');

async function main(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 1 });
  await migrate(drizzle({ client: sql }), { migrationsFolder: 'drizzle' });
  await sql.end();
  console.log('Migrations applied.');
}

main(url).catch((error) => {
  console.error(error);
  process.exit(1);
});
