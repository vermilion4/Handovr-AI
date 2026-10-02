import { randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { paypal } from './client.mts';

const currency = process.argv[2] ?? 'CAD';
const value = process.argv[3] ?? '100.00';
const batchId = randomUUID();

const body = {
  sender_batch_header: {
    sender_batch_id: batchId,
    email_subject: 'Your Handovr.ai milestone payment',
    email_message: 'Contact page: payment released.',
  },
  items: [
    {
      recipient_type: 'EMAIL',
      receiver: process.env.PAYPAL_SANDBOX_FREELANCER_EMAIL,
      amount: { currency, value },
      note: 'Contact page milestone',
      sender_item_id: 'milestone-2',
    },
  ],
};

const created = await paypal('POST', '/v1/payments/payouts', body, { 'PayPal-Request-Id': batchId });
console.log(`create ${value} ${currency}: HTTP ${created.status}`, JSON.stringify(created.body?.batch_header ?? created.body));
if (created.status >= 300) process.exit(1);

const replay = await paypal('POST', '/v1/payments/payouts', body, { 'PayPal-Request-Id': batchId });
console.log(`same batch sent again: HTTP ${replay.status}`, replay.body?.name ?? replay.body?.batch_header?.payout_batch_id);

const id = created.body.batch_header.payout_batch_id;
for (let attempt = 0; attempt < 10; attempt++) {
  await wait(3000);
  const res = await paypal('GET', `/v1/payments/payouts/${id}`);
  const item = res.body.items?.[0];
  console.log(`batch ${res.body.batch_header.batch_status}, item ${item?.transaction_status}`, JSON.stringify({
    fees: res.body.batch_header.fees,
    amount: item?.payout_item?.amount,
    fee: item?.payout_item_fee,
    conversion: item?.currency_conversion,
    errors: item?.errors,
  }));
  if (['SUCCESS', 'DENIED', 'CANCELED'].includes(res.body.batch_header.batch_status)) break;
}
