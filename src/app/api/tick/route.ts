import { db } from '@/db/client';
import { liveGateway } from '@/payments/live';
import { runTick, validTickKey } from '@/payments/tick';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get('key');
  if (!validTickKey(key, process.env.TICK_SECRET)) return new Response('Not found', { status: 404 });

  const report = await runTick(db, liveGateway(), new Date());
  return Response.json(report, { status: report.errors.length ? 500 : 200 });
}
