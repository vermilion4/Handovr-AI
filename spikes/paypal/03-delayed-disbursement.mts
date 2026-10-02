import { randomUUID } from 'node:crypto';
import { paypal } from './client.mts';

const res = await paypal(
  'POST',
  '/v2/checkout/orders',
  {
    intent: 'CAPTURE',
    purchase_units: [
      {
        amount: { currency_code: 'USD', value: '600.00' },
        payee: { email_address: process.env.PAYPAL_SANDBOX_FREELANCER_EMAIL || process.env.PAYPAL_SANDBOX_CLIENT_EMAIL },
        payment_instruction: {
          disbursement_mode: 'DELAYED',
          platform_fees: [{ amount: { currency_code: 'USD', value: '0.00' } }],
        },
      },
    ],
  },
  { 'PayPal-Request-Id': randomUUID() },
);
console.log(`HTTP ${res.status} debug ${res.debugId}`);
console.log(JSON.stringify(res.body, null, 2));
