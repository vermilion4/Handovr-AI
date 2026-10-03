import { eq } from 'drizzle-orm';
import { getCurrentUser } from '@/auth/current-user';
import { db } from '@/db/client';
import { evidence, milestones, projects, submissions } from '@/db/schema';
import { isUuid } from '@/domain/ids';

export async function GET(_request: Request, { params }: { params: Promise<{ evidenceId: string }> }) {
  const user = await getCurrentUser();
  const { evidenceId } = await params;
  if (!user || !isUuid(evidenceId)) return new Response('Not found', { status: 404 });

  const [row] = await db
    .select({ image: evidence.image, clientId: projects.clientId, freelancerId: projects.freelancerId })
    .from(evidence)
    .innerJoin(submissions, eq(submissions.id, evidence.submissionId))
    .innerJoin(milestones, eq(milestones.id, submissions.milestoneId))
    .innerJoin(projects, eq(projects.id, milestones.projectId))
    .where(eq(evidence.id, evidenceId))
    .limit(1);
  if (!row?.image || (row.clientId !== user.id && row.freelancerId !== user.id)) return new Response('Not found', { status: 404 });

  return new Response(Buffer.from(row.image), {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' },
  });
}
