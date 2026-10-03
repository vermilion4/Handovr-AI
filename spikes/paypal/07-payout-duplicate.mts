import { randomUUID } from 'node:crypto';
import { paypal } from './client.mts';

const batchId = randomUUID();
const body = {
  sender_batch_header: { sender_batch_id: batchId, email_subject: 'Handovr.ai duplicate probe' },
  items: [{ recipient_type: 'EMAIL', receiver: process.env.PAYPAL_SANDBOX_FREELANCER_EMAIL, amount: { currency: 'CAD', value: '1.00' }, sender_item_id: 'probe' }],
};
const first = await paypal('POST', '/v1/payments/payouts', body, { 'PayPal-Request-Id': batchId });
console.log('first', first.status, JSON.stringify(first.body.batch_header));
const second = await paypal('POST', '/v1/payments/payouts', body, { 'PayPal-Request-Id': batchId });
console.log('second', second.status, JSON.stringify(second.body));
const noHeader = await paypal('POST', '/v1/payments/payouts', body);
console.log('second without request id', noHeader.status, JSON.stringify(noHeader.body));
const fetched = await paypal('GET', `/v1/payments/payouts/${first.body.batch_header.payout_batch_id}?fields=batch_header`);
console.log('get', fetched.status, JSON.stringify(fetched.body.batch_header), 'items', fetched.body.items?.length);
