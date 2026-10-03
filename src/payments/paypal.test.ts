import { describe, expect, it } from 'vitest';
import { GatewayError } from './gateway';
import { centsToValue, paypalGateway } from './paypal';

interface Sent {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch that answers each path with the queued responses, in order. */
function fakePayPal(routes: Record<string, Array<[status: number, body: unknown]>>) {
  const sent: Sent[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace('https://api-m.sandbox.paypal.com', '');
    if (path === '/v1/oauth2/token') {
      return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 });
    }
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    sent.push({ method: init?.method ?? 'GET', path, headers: init?.headers as Record<string, string>, body });
    const queue = routes[`${init?.method ?? 'GET'} ${path}`];
    if (!queue?.length) throw new Error(`No answer queued for ${init?.method} ${path}`);
    const [status, answer] = queue.shift()!;
    return new Response(answer === null ? null : JSON.stringify(answer), { status });
  }) as typeof fetch;
  return { sent, gateway: paypalGateway({ clientId: 'id', clientSecret: 'secret', webhookId: 'WH-1', fetchImpl: impl }) };
}

describe('centsToValue', () => {
  it('writes cents as a decimal amount without floating point', () => {
    expect(centsToValue(61823)).toBe('618.23');
    expect(centsToValue(100)).toBe('1.00');
    expect(centsToValue(5)).toBe('0.05');
    expect(centsToValue(120000)).toBe('1200.00');
  });
});

describe('createHoldOrder', () => {
  it('creates an authorise order in Canadian dollars and returns where to approve it', async () => {
    const { gateway, sent } = fakePayPal({
      'POST /v2/checkout/orders': [[200, { id: 'ORDER-9', links: [{ rel: 'self', href: 'x' }, { rel: 'payer-action', href: 'https://paypal/approve' }] }]],
    });
    const result = await gateway.createHoldOrder({
      requestId: 'req-1',
      totalCents: 61823,
      description: "Chen's Bakery website: Contact page",
      returnUrl: 'http://app/return',
      cancelUrl: 'http://app/cancel',
    });

    expect(result).toEqual({ orderId: 'ORDER-9', approveUrl: 'https://paypal/approve' });
    expect(sent[0].headers['PayPal-Request-Id']).toBe('req-1');
    expect(sent[0].headers.Authorization).toBe('Bearer token');
    expect(sent[0].body).toMatchObject({
      intent: 'AUTHORIZE',
      purchase_units: [{ amount: { currency_code: 'CAD', value: '618.23' } }],
      payment_source: { paypal: { experience_context: { return_url: 'http://app/return', cancel_url: 'http://app/cancel' } } },
    });
  });
});

describe('authorizeOrder', () => {
  const path = 'POST /v2/checkout/orders/ORDER-9/authorize';

  it('returns the authorisation and when it expires', async () => {
    const { gateway } = fakePayPal({
      [path]: [[201, { purchase_units: [{ payments: { authorizations: [{ id: 'AUTH-9', status: 'CREATED', expiration_time: '2026-10-31T16:54:42Z' }] } }] }]],
    });
    expect(await gateway.authorizeOrder({ requestId: 'r', orderId: 'ORDER-9' })).toEqual({
      authorizationId: 'AUTH-9',
      expiresAt: new Date('2026-10-31T16:54:42Z'),
    });
  });

  it('reads the hold back when the order was already authorised by an earlier request', async () => {
    const { gateway } = fakePayPal({
      [path]: [[422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_AUTHORIZED' }] }]],
      'GET /v2/checkout/orders/ORDER-9': [
        [200, { purchase_units: [{ payments: { authorizations: [{ id: 'AUTH-9', status: 'CREATED', expiration_time: '2026-10-31T16:54:42Z' }] } }] }],
      ],
    });
    expect(await gateway.authorizeOrder({ requestId: 'r', orderId: 'ORDER-9' })).toEqual({
      authorizationId: 'AUTH-9',
      expiresAt: new Date('2026-10-31T16:54:42Z'),
    });
  });

  it('reports an order the payer did not approve, and a denied hold, as declined', async () => {
    const { gateway } = fakePayPal({
      [path]: [
        [422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_NOT_APPROVED' }] }],
        [201, { purchase_units: [{ payments: { authorizations: [{ id: 'AUTH-9', status: 'DENIED' }] } }] }],
      ],
    });
    expect(await gateway.authorizeOrder({ requestId: 'r', orderId: 'ORDER-9' })).toEqual({ declined: 'ORDER_NOT_APPROVED' });
    expect(await gateway.authorizeOrder({ requestId: 'r', orderId: 'ORDER-9' })).toEqual({ declined: 'DENIED' });
  });
});

describe('capture', () => {
  const path = 'POST /v2/payments/authorizations/AUTH-9/capture';

  it('captures the amount as the final capture', async () => {
    const { gateway, sent } = fakePayPal({ [path]: [[201, { id: 'CAP-1', status: 'COMPLETED' }]] });
    expect(await gateway.capture({ requestId: 'r', authorizationId: 'AUTH-9', amountCents: 37106, note: 'Contact page' })).toEqual({ captureId: 'CAP-1' });
    expect(sent[0].body).toEqual({ amount: { currency_code: 'CAD', value: '371.06' }, final_capture: true, note_to_payer: 'Contact page' });
    expect(sent[0].headers['PayPal-Request-Id']).toBe('r');
  });

  it('throws a refusal PayPal will not change its mind about', async () => {
    const { gateway } = fakePayPal({ [path]: [[422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'AUTHORIZATION_VOIDED' }] }]] });
    const error = await gateway.capture({ requestId: 'r', authorizationId: 'AUTH-9', amountCents: 100, note: '' }).catch((e) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject({ status: 422, issue: 'AUTHORIZATION_VOIDED', refused: true });
  });

  it('throws something worth retrying when PayPal has a server error or cannot be reached', async () => {
    const { gateway } = fakePayPal({ [path]: [[503, null]] });
    const error = await gateway.capture({ requestId: 'r', authorizationId: 'AUTH-9', amountCents: 100, note: '' }).catch((e) => e);
    expect(error).toMatchObject({ status: 503, refused: false });

    const unreachable = paypalGateway({
      clientId: 'id',
      clientSecret: 'secret',
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    expect(await unreachable.voidAuthorization('AUTH-9').catch((e) => e)).toMatchObject({ status: 0, refused: false });
  });

  it('treats a capture PayPal declined as a refusal', async () => {
    const { gateway } = fakePayPal({ [path]: [[201, { id: 'CAP-1', status: 'DECLINED' }]] });
    expect(await gateway.capture({ requestId: 'r', authorizationId: 'AUTH-9', amountCents: 100, note: '' }).catch((e) => e)).toMatchObject({
      issue: 'CAPTURE_DECLINED',
      refused: true,
    });
  });
});

describe('errors that are not a refusal of the request itself', () => {
  it('treats a credentials problem or a malformed request as worth retrying, and asks for a new token after a 401', async () => {
    let tokens = 0;
    const answers = [401, 403, 400, 404];
    const gateway = paypalGateway({
      clientId: 'id',
      clientSecret: 'secret',
      fetchImpl: (async (url: string | URL | Request) => {
        if (String(url).endsWith('/v1/oauth2/token')) {
          tokens += 1;
          return new Response(JSON.stringify({ access_token: `token-${tokens}`, expires_in: 3600 }), { status: 200 });
        }
        return new Response(JSON.stringify({ name: 'SOMETHING' }), { status: answers.shift()! });
      }) as typeof fetch,
    });
    const attempt = () => gateway.capture({ requestId: 'r', authorizationId: 'AUTH-9', amountCents: 100, note: '' }).catch((e) => e);

    expect(await attempt()).toMatchObject({ status: 401, refused: false });
    expect(await attempt()).toMatchObject({ status: 403, refused: false });
    expect(tokens).toBe(2);
    expect(await attempt()).toMatchObject({ status: 400, refused: false });
    expect(await attempt()).toMatchObject({ status: 404, refused: true });
  });
});

describe('voidAuthorization', () => {
  it('accepts a hold that is already void', async () => {
    const { gateway } = fakePayPal({
      'POST /v2/payments/authorizations/AUTH-9/void': [[422, { details: [{ issue: 'PREVIOUSLY_VOIDED' }] }]],
    });
    await expect(gateway.voidAuthorization('AUTH-9')).resolves.toBeUndefined();
  });
});

describe('reauthorize and authorizationStatus', () => {
  it('returns the renewed authorisation', async () => {
    const { gateway, sent } = fakePayPal({
      'POST /v2/payments/authorizations/AUTH-9/reauthorize': [[201, { id: 'AUTH-10', expiration_time: '2026-11-24T12:00:00Z' }]],
    });
    expect(await gateway.reauthorize({ requestId: 'r', authorizationId: 'AUTH-9', totalCents: 61823 })).toEqual({
      authorizationId: 'AUTH-10',
      expiresAt: new Date('2026-11-24T12:00:00Z'),
    });
    expect(sent[0].body).toEqual({ amount: { currency_code: 'CAD', value: '618.23' } });
  });

  it('reads the state of a hold', async () => {
    const { gateway } = fakePayPal({
      'GET /v2/payments/authorizations/AUTH-9': [[200, { status: 'CREATED' }], [200, { status: 'VOIDED' }], [200, { status: 'CAPTURED' }], [200, { status: 'DENIED' }]],
    });
    expect(await gateway.authorizationStatus('AUTH-9')).toBe('active');
    expect(await gateway.authorizationStatus('AUTH-9')).toBe('voided');
    expect(await gateway.authorizationStatus('AUTH-9')).toBe('captured');
    expect(await gateway.authorizationStatus('AUTH-9')).toBe('other');
  });
});

describe('sendPayout', () => {
  it('sends one item in Canadian dollars under the given batch id', async () => {
    const { gateway, sent } = fakePayPal({ 'POST /v1/payments/payouts': [[201, { batch_header: { payout_batch_id: 'PB-1' } }]] });
    expect(await gateway.sendPayout({ batchId: 'batch-1', email: 'tomas@example.com', amountCents: 60000, note: 'Contact page' })).toEqual({ payoutBatchId: 'PB-1' });
    expect(sent[0].body).toMatchObject({
      sender_batch_header: { sender_batch_id: 'batch-1' },
      items: [{ recipient_type: 'EMAIL', receiver: 'tomas@example.com', amount: { currency: 'CAD', value: '600.00' } }],
    });
  });

  it('finds the earlier batch when the same batch id is sent again', async () => {
    const { gateway } = fakePayPal({
      'POST /v1/payments/payouts': [
        [400, { name: 'USER_BUSINESS_ERROR', details: [{ field: 'SENDER_BATCH_ID', issue: 'Batch with given sender_batch_id already exists', link: [{ href: 'https://api.sandbox.paypal.com/v1/payments/payouts/PB-1', rel: 'self' }] }] }],
      ],
    });
    expect(await gateway.sendPayout({ batchId: 'batch-1', email: 'tomas@example.com', amountCents: 60000, note: '' })).toEqual({ payoutBatchId: 'PB-1' });
  });

  it('throws a refusal for a payout PayPal will not send', async () => {
    const { gateway } = fakePayPal({ 'POST /v1/payments/payouts': [[422, { name: 'INSUFFICIENT_FUNDS' }]] });
    expect(await gateway.sendPayout({ batchId: 'b', email: 'x@example.com', amountCents: 100, note: '' }).catch((e) => e)).toMatchObject({
      issue: 'INSUFFICIENT_FUNDS',
      refused: true,
    });
  });
});

describe('payoutStatus', () => {
  const answers = (item: string | undefined, batch = 'PROCESSING') =>
    fakePayPal({ 'GET /v1/payments/payouts/PB-1': [[200, { batch_header: { batch_status: batch }, items: item ? [{ transaction_status: item, errors: { message: 'Receiver is blocked' } }] : [] }]] }).gateway;

  it('is pending until the item settles', async () => {
    expect(await answers(undefined, 'PENDING').payoutStatus('PB-1')).toEqual({ status: 'pending', detail: '' });
    expect(await answers('PENDING').payoutStatus('PB-1')).toEqual({ status: 'pending', detail: '' });
  });

  it('is a success when paid, and when waiting to be claimed', async () => {
    expect(await answers('SUCCESS', 'SUCCESS').payoutStatus('PB-1')).toEqual({ status: 'success', detail: '' });
    expect(await answers('UNCLAIMED', 'SUCCESS').payoutStatus('PB-1')).toEqual({ status: 'success', detail: 'unclaimed' });
  });

  it('is a failure when the item or the batch was refused', async () => {
    expect(await answers('FAILED').payoutStatus('PB-1')).toEqual({ status: 'failed', detail: 'Receiver is blocked' });
    expect(await answers(undefined, 'DENIED').payoutStatus('PB-1')).toEqual({ status: 'failed', detail: 'DENIED' });
  });
});

describe('verifyWebhook', () => {
  const headers = new Headers({
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://api.sandbox.paypal.com/cert',
    'paypal-transmission-id': 't-1',
    'paypal-transmission-sig': 'sig',
    'paypal-transmission-time': '2026-10-02T12:00:00Z',
  });

  it('asks PayPal to check the signature against this app\'s webhook', async () => {
    const { gateway, sent } = fakePayPal({
      'POST /v1/notifications/verify-webhook-signature': [[200, { verification_status: 'SUCCESS' }], [200, { verification_status: 'FAILURE' }]],
    });
    expect(await gateway.verifyWebhook({ headers, body: '{"id":"WH-EVENT-1"}' })).toBe(true);
    expect(sent[0].body).toEqual({
      auth_algo: 'SHA256withRSA',
      cert_url: 'https://api.sandbox.paypal.com/cert',
      transmission_id: 't-1',
      transmission_sig: 'sig',
      transmission_time: '2026-10-02T12:00:00Z',
      webhook_id: 'WH-1',
      webhook_event: { id: 'WH-EVENT-1' },
    });
    expect(await gateway.verifyWebhook({ headers, body: '{"id":"WH-EVENT-1"}' })).toBe(false);
  });

  it('refuses a body that is not JSON, missing headers, and an app with no webhook id', async () => {
    const { gateway } = fakePayPal({});
    expect(await gateway.verifyWebhook({ headers, body: 'not json' })).toBe(false);
    expect(await gateway.verifyWebhook({ headers: new Headers(), body: '{}' })).toBe(false);
    const noWebhook = paypalGateway({ clientId: 'id', clientSecret: 'secret' });
    expect(await noWebhook.verifyWebhook({ headers, body: '{}' })).toBe(false);
  });
});
