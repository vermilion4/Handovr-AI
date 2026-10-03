'use server';

import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/auth/current-user';
import { requestOrigin } from '@/app/request-origin';
import { db } from '@/db/client';
import { isUuid } from '@/domain/ids';
import { startFunding } from '@/payments/funding';
import { liveGateway } from '@/payments/live';

export async function fundAction(milestoneId: string): Promise<{ error: string }> {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');
  if (typeof milestoneId !== 'string' || !isUuid(milestoneId)) return { error: 'That milestone does not exist.' };

  const result = await startFunding(db, liveGateway(), {
    milestoneId,
    userId: user.id,
    origin: await requestOrigin(),
  });
  if (!result.ok) return { error: result.reason };
  redirect(result.approveUrl);
}
