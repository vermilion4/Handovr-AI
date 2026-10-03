import { db } from '@/db/client';
import { liveNotice } from '@/notifications/live';
import { liveGateway } from '@/payments/live';
import { handleWebhook } from '@/payments/webhooks';

export async function POST(request: Request) {
  const outcome = await handleWebhook(
    db,
    liveGateway(),
    { headers: request.headers, body: await request.text(), now: new Date() },
    liveNotice(db),
  );
  return new Response(outcome, { status: outcome === 'rejected' ? 400 : 200 });
}
