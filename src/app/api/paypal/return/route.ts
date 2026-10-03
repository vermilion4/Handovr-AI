import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { getCurrentUser } from '@/auth/current-user';
import { db } from '@/db/client';
import { isUuid } from '@/domain/ids';
import { confirmFunding } from '@/payments/funding';
import { liveGateway } from '@/payments/live';
import { processPayments } from '@/payments/processor';

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  const holdId = new URL(request.url).searchParams.get('hold') ?? '';
  if (!isUuid(holdId)) redirect('/projects');

  const result = await confirmFunding(db, liveGateway(), { holdId, userId: user.id, now: new Date() });
  if (result.ok) {
    // A release that was waiting on this funding can go ahead now.
    after(() => processPayments(db, liveGateway(), new Date()));
    redirect(`/projects/${result.projectId}?funded=${result.milestoneId}`);
  }
  if (!result.projectId || !result.milestoneId) redirect('/projects');
  if (result.problem === 'refused') redirect(`/projects/${result.projectId}`);
  redirect(`/projects/${result.projectId}/fund/${result.milestoneId}?problem=${result.problem}`);
}
