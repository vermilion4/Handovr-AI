import { randomUUID } from 'node:crypto';
import { paypal } from './client.mts';
import { saveState } from './state.mts';

const name = process.argv[2] ?? 'hold';
const currency = process.argv[3] ?? 'CAD';

const res = await paypal(
  'POST',
  '/v2/checkout/orders',
  {
    intent: 'AUTHORIZE',
    purchase_units: [
      {
        reference_id: 'milestone-2',
        description: "Chen's Bakery website: Contact page",
        amount: { currency_code: currency, value: '600.00' },
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: 'Handovr.ai',
          user_action: 'PAY_NOW',
          shipping_preference: 'NO_SHIPPING',
          return_url: 'http://localhost:3000/spike/return',
          cancel_url: 'http://localhost:3000/spike/cancel',
        },
      },
    },
  },
  { 'PayPal-Request-Id': randomUUID() },
);

console.log(res.status, res.body.status ?? res.body);
if (res.status >= 300) process.exit(1);

saveState({ [`${name}OrderId`]: res.body.id });
const approve = res.body.links.find((link: { rel: string }) => link.rel === 'payer-action');
console.log(`Order ${res.body.id} saved as "${name}".`);
console.log('Approve it here as the sandbox client:');
console.log(approve.href);
