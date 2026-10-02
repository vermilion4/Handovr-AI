import { randomUUID } from 'node:crypto';
import { paypal } from './client.mts';
import { readState, saveState } from './state.mts';

const state = readState();
const show = (label: string, res: { status: number; body: any; debugId: string | null }) =>
  console.log(`\n${label}: HTTP ${res.status}\n${JSON.stringify(res.body, null, 2)}`);

async function authorize(name: string): Promise<string> {
  const saved = state[`${name}AuthId`];
  if (saved) return saved;
  const res = await paypal('POST', `/v2/checkout/orders/${state[`${name}OrderId`]}/authorize`, {}, {
    'PayPal-Request-Id': randomUUID(),
  });
  if (res.status >= 300) {
    show(`authorize ${name}`, res);
    process.exit(1);
  }
  const auth = res.body.purchase_units[0].payments.authorizations[0];
  console.log(`\nauthorize ${name}: ${auth.status}, id ${auth.id}, expires ${auth.expiration_time}`);
  saveState({ [`${name}AuthId`]: auth.id });
  return auth.id;
}

const holdAuth = await authorize('hold');
show('authorization details', await paypal('GET', `/v2/payments/authorizations/${holdAuth}`));

show(
  'reauthorize straight away',
  await paypal('POST', `/v2/payments/authorizations/${holdAuth}/reauthorize`, {
    amount: { currency_code: 'USD', value: '600.00' },
  }, { 'PayPal-Request-Id': randomUUID() }),
);

const captureKey = randomUUID();
const captureBody = {
  amount: { currency_code: 'USD', value: '360.00' },
  final_capture: true,
  note_to_payer: 'Contact page: 3 of 5 criteria approved',
};
const capture = await paypal('POST', `/v2/payments/authorizations/${holdAuth}/capture`, captureBody, {
  'PayPal-Request-Id': captureKey,
  Prefer: 'return=representation',
});
show('partial capture of $360 with final_capture', capture);

const repeat = await paypal('POST', `/v2/payments/authorizations/${holdAuth}/capture`, captureBody, {
  'PayPal-Request-Id': captureKey,
  Prefer: 'return=representation',
});
console.log(`\nsame capture replayed with the same request id: HTTP ${repeat.status}, capture id ${repeat.body?.id} (first was ${capture.body?.id})`);

show('authorization after final capture', await paypal('GET', `/v2/payments/authorizations/${holdAuth}`));

const voidAuth = await authorize('void');
show('void the second hold', await paypal('POST', `/v2/payments/authorizations/${voidAuth}/void`, undefined, {
  Prefer: 'return=representation',
}));
