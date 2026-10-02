import { randomUUID } from 'node:crypto';
import { paypal } from './client.mts';
import { readState } from './state.mts';

const { cadOrderId } = readState();
const authorized = await paypal('POST', `/v2/checkout/orders/${cadOrderId}/authorize`, {}, {
  'PayPal-Request-Id': randomUUID(),
});
const auth = authorized.body.purchase_units?.[0]?.payments?.authorizations?.[0];
console.log(`authorize: HTTP ${authorized.status}`, auth?.status ?? JSON.stringify(authorized.body));
if (!auth) process.exit(1);

const capture = await paypal('POST', `/v2/payments/authorizations/${auth.id}/capture`, {
  amount: { currency_code: 'CAD', value: '600.00' },
  final_capture: true,
}, { 'PayPal-Request-Id': randomUUID(), Prefer: 'return=representation' });
console.log(`capture: HTTP ${capture.status}`, capture.body.status);
console.log(JSON.stringify(capture.body.seller_receivable_breakdown, null, 2));
