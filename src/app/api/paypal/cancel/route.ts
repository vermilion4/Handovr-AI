import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/auth/current-user';
import { db } from '@/db/client';
import { isUuid } from '@/domain/ids';
import { cancelFunding } from '@/payments/funding';

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  const holdId = new URL(request.url).searchParams.get('hold') ?? '';
  const where = isUuid(holdId) ? await cancelFunding(db, { holdId, userId: user.id }) : null;
  if (!where) redirect('/projects');
  redirect(`/projects/${where.projectId}/fund/${where.milestoneId}?problem=cancelled`);
}
