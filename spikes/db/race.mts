import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
const R = '../../src';
const { schema, users, milestones } = await import(`${R}/db/schema.ts`);
const q = await import(`${R}/db/queries/contract.ts`);

const sql = postgres(process.env.DATABASE_URL!, { max: 10 });
const db = drizzle({ client: sql, schema });
const now = new Date();
const drafted = [
  { description: 'A', testPlan: 'Do A.', kind: 'machine', category: 'function', shareCents: 40000 },
  { description: 'B', testPlan: 'Look at B.', kind: 'human', category: null, shareCents: 20000 },
];
const stamp = Date.now();
const [client] = await db.insert(users).values({ name: 'Race Client', email: `race-client-${stamp}@example.com`, role: 'client' }).returning();
const [freelancer] = await db.insert(users).values({ name: 'Race Freelancer', email: `race-free-${stamp}@example.com`, role: 'freelancer' }).returning();

let stuck = 0, crashed = 0, bothWon = 0;
const ROUNDS = 25;
for (let round = 0; round < ROUNDS; round++) {
  const projectId = await q.createProject(db, { clientId: client.id, title: `Race ${stamp} ${round}`, freelancerEmail: freelancer.email,
    milestones: [{ title: 'Sign race', brief: 'A brief long enough.', amountCents: 60000 }, { title: 'Edit race', brief: 'A brief long enough.', amountCents: 60000 }] }, now);
  for (const id of await q.listPendingDrafts(db, projectId)) { await q.claimDraft(db, id, now); await q.saveDraft(db, id, drafted); }
  const [signM, editM] = (await q.getContract(db, projectId, client.id)).milestones;

  await Promise.all([
    q.signMilestones(db, { projectId, userId: client.id, versionIds: [signM.version.id], typedName: 'Race Client', agreed: true, now }),
    q.signMilestones(db, { projectId, userId: freelancer.id, versionIds: [signM.version.id], typedName: 'Race Freelancer', agreed: true, now }),
  ]);
  const [row] = await db.select().from(milestones).where(eq(milestones.id, signM.id));
  if (row.state !== 'signed') stuck++;

  const reworded = (text: string) => editM.version.criteria.map((c, i) => (i === 0 ? { ...c, description: text } : c));
  const results = await Promise.allSettled([
    q.saveEdit(db, { milestoneId: editM.id, authorId: client.id, baseVersionId: editM.version.id, items: reworded('Client wording'), reason: '' }),
    q.saveEdit(db, { milestoneId: editM.id, authorId: freelancer.id, baseVersionId: editM.version.id, items: reworded('Freelancer wording'), reason: '' }),
  ]);
  if (results.some((r) => r.status === 'rejected')) crashed++;
  if (results.every((r) => r.status === 'fulfilled' && r.value.ok)) bothWon++;
}
console.log(JSON.stringify({ rounds: ROUNDS, signStuckInDrafting: stuck, editCrashed: crashed, editBothAccepted: bothWon }));
await sql.end();
