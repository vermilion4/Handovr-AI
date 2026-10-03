import { after } from 'next/server';
import { db } from '@/db/client';
import { liveNotice } from '@/notifications/live';
import { liveGateway } from '@/payments/live';
import { runTick, validTickKey } from '@/payments/tick';
import { expireSettlements } from '@/settlement/respond';
import { liveVerificationDeps } from '@/verification/live';
import { verificationsToRun } from '@/verification/restart';
import { expireReviews } from '@/verification/review';
import { runVerification } from '@/verification/run';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get('key');
  if (!validTickKey(key, process.env.TICK_SECRET)) return new Response('Not found', { status: 404 });

  const now = new Date();
  // Reviews end first, so the releases they start are sent in this same tick.
  const reviewsReleased = await expireReviews(db, now);
  const notice = liveNotice(db);
  const settlementsExpired = await expireSettlements(db, now, notice);
  const report = await runTick(db, liveGateway(), now, notice);
  const toRun = await verificationsToRun(db, now);

  if (toRun.length > 0) {
    after(async () => {
      const deps = liveVerificationDeps(db);
      for (const id of toRun) {
        await runVerification(db, deps, id).catch((error) => console.error(`Verification run ${id} failed`, error));
      }
    });
  }

  return Response.json(
    { ...report, reviewsReleased, settlementsExpired, runsStarted: toRun.length },
    { status: report.errors.length ? 500 : 200 },
  );
}
