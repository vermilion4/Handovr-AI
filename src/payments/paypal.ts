import { CURRENCY } from '../domain/money';
import { GatewayError, type PaymentGateway } from './gateway';

const BASE = 'https://api-m.sandbox.paypal.com';
const HOLD_MS = 29 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20_000;

export function centsToValue(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** Reads a nested value out of PayPal's JSON without assuming its shape. */
function dig(value: unknown, ...path: Array<string | number>): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

interface Answer {
  status: number;
  body: unknown;
}

function issueOf(answer: Answer): string | null {
  return text(dig(answer.body, 'details', 0, 'issue')) ?? text(dig(answer.body, 'name'));
}

function fail(action: string, answer: Answer): never {
  const issue = issueOf(answer);
  throw new GatewayError(`${action} failed: ${issue ?? `HTTP ${answer.status}`}`, answer.status, issue);
}

const ok = (answer: Answer) => answer.status >= 200 && answer.status < 300;

export function paypalGateway(config: {
  clientId: string;
  clientSecret: string;
  webhookId?: string;
  fetchImpl?: typeof fetch;
}): PaymentGateway {
  const request = config.fetchImpl ?? fetch;
  let token: { value: string; expiresAt: number } | null = null;

  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await request(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      throw new GatewayError(`PayPal could not be reached: ${error instanceof Error ? error.message : error}`, 0);
    }
  }

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt > Date.now() + 60_000) return token.value;
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
    const response = await send(`${BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const body: unknown = await response.json().catch(() => null);
    const value = text(dig(body, 'access_token'));
    if (!response.ok || !value) throw new GatewayError('PayPal refused the app credentials', response.status);
    token = { value, expiresAt: Date.now() + Number(dig(body, 'expires_in') ?? 0) * 1000 };
    return value;
  }

  async function call(method: string, path: string, options: { body?: unknown; requestId?: string } = {}): Promise<Answer> {
    const response = await send(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...(options.requestId ? { 'PayPal-Request-Id': options.requestId } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (response.status === 401) token = null;
    const raw = await response.text();
    let body: unknown = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }
    return { status: response.status, body };
  }

  const amount = (cents: number) => ({ currency_code: CURRENCY, value: centsToValue(cents) });
  const expiry = (value: unknown) => new Date(text(value) ?? Date.now() + HOLD_MS);

  return {
    async createHoldOrder(input) {
      const answer = await call('POST', '/v2/checkout/orders', {
        requestId: input.requestId,
        body: {
          intent: 'AUTHORIZE',
          purchase_units: [{ description: input.description.slice(0, 127), amount: amount(input.totalCents) }],
          payment_source: {
            paypal: {
              experience_context: {
                brand_name: 'Handovr.ai',
                user_action: 'PAY_NOW',
                shipping_preference: 'NO_SHIPPING',
                return_url: input.returnUrl,
                cancel_url: input.cancelUrl,
              },
            },
          },
        },
      });
      const links = dig(answer.body, 'links');
      const approve = Array.isArray(links)
        ? links.find((link) => dig(link, 'rel') === 'payer-action') ?? links.find((link) => dig(link, 'rel') === 'approve')
        : undefined;
      const orderId = text(dig(answer.body, 'id'));
      const approveUrl = text(dig(approve, 'href'));
      if (!ok(answer) || !orderId || !approveUrl) fail('Creating the order', answer);
      return { orderId, approveUrl };
    },

    async authorizeOrder(input) {
      let answer = await call('POST', `/v2/checkout/orders/${input.orderId}/authorize`, { requestId: input.requestId, body: {} });
      // An earlier request already placed this hold, so read it back from the order.
      if (answer.status === 422 && issueOf(answer) === 'ORDER_ALREADY_AUTHORIZED') {
        answer = await call('GET', `/v2/checkout/orders/${input.orderId}`);
      }
      if (answer.status === 422) return { declined: issueOf(answer) ?? 'UNPROCESSABLE_ENTITY' };
      const authorization = dig(answer.body, 'purchase_units', 0, 'payments', 'authorizations', 0);
      const authorizationId = text(dig(authorization, 'id'));
      if (!ok(answer) || !authorizationId) fail('Placing the hold', answer);

      const status = text(dig(authorization, 'status'));
      if (status !== 'CREATED' && status !== 'PENDING') return { declined: status ?? 'UNKNOWN' };
      return { authorizationId, expiresAt: expiry(dig(authorization, 'expiration_time')) };
    },

    async reauthorize(input) {
      const answer = await call('POST', `/v2/payments/authorizations/${input.authorizationId}/reauthorize`, {
        requestId: input.requestId,
        body: { amount: amount(input.totalCents) },
      });
      const authorizationId = text(dig(answer.body, 'id'));
      if (!ok(answer) || !authorizationId) fail('Renewing the hold', answer);
      return { authorizationId, expiresAt: expiry(dig(answer.body, 'expiration_time')) };
    },

    async capture(input) {
      const answer = await call('POST', `/v2/payments/authorizations/${input.authorizationId}/capture`, {
        requestId: input.requestId,
        body: { amount: amount(input.amountCents), final_capture: true, note_to_payer: input.note.slice(0, 255) },
      });
      const captureId = text(dig(answer.body, 'id'));
      if (!ok(answer) || !captureId) fail('Capturing the hold', answer);

      const status = text(dig(answer.body, 'status'));
      if (status !== 'COMPLETED' && status !== 'PENDING') {
        throw new GatewayError(`Capturing the hold failed: ${status}`, 422, `CAPTURE_${status}`);
      }
      return { captureId };
    },

    async voidAuthorization(authorizationId) {
      const answer = await call('POST', `/v2/payments/authorizations/${authorizationId}/void`);
      if (ok(answer)) return;
      const issue = issueOf(answer);
      if (answer.status === 422 && (issue === 'PREVIOUSLY_VOIDED' || issue === 'AUTHORIZATION_VOIDED')) return;
      fail('Cancelling the hold', answer);
    },

    async authorizationStatus(authorizationId) {
      const answer = await call('GET', `/v2/payments/authorizations/${authorizationId}`);
      if (!ok(answer)) fail('Reading the hold', answer);
      const status = text(dig(answer.body, 'status'));
      if (status === 'CREATED' || status === 'PENDING') return 'active';
      if (status === 'CAPTURED' || status === 'PARTIALLY_CAPTURED') return 'captured';
      return status === 'VOIDED' ? 'voided' : 'other';
    },

    async sendPayout(input) {
      const answer = await call('POST', '/v1/payments/payouts', {
        requestId: input.batchId,
        body: {
          sender_batch_header: {
            sender_batch_id: input.batchId,
            email_subject: 'Your Handovr.ai milestone payment',
            email_message: input.note.slice(0, 1000),
          },
          items: [
            {
              recipient_type: 'EMAIL',
              receiver: input.email,
              amount: { currency: CURRENCY, value: centsToValue(input.amountCents) },
              note: input.note.slice(0, 1000),
              sender_item_id: input.batchId,
            },
          ],
        },
      });

      const payoutBatchId = text(dig(answer.body, 'batch_header', 'payout_batch_id'));
      if (ok(answer) && payoutBatchId) return { payoutBatchId };

      // PayPal answers a repeated batch id with an error that links to the batch it already has.
      const earlier = text(dig(answer.body, 'details', 0, 'link', 0, 'href'));
      const repeated = String(dig(answer.body, 'details', 0, 'issue') ?? '').includes('already exists');
      if (answer.status === 400 && repeated && earlier) {
        return { payoutBatchId: earlier.slice(earlier.lastIndexOf('/') + 1) };
      }
      fail('Sending the payout', answer);
    },

    async payoutStatus(payoutBatchId) {
      const answer = await call('GET', `/v1/payments/payouts/${payoutBatchId}`);
      if (!ok(answer)) fail('Reading the payout', answer);

      const batch = text(dig(answer.body, 'batch_header', 'batch_status'));
      const item = text(dig(answer.body, 'items', 0, 'transaction_status'));
      if (item === 'SUCCESS') return { status: 'success', detail: '' };
      if (item === 'UNCLAIMED') return { status: 'success', detail: 'unclaimed' };
      if (item && ['FAILED', 'RETURNED', 'BLOCKED', 'REFUNDED', 'REVERSED', 'DENIED'].includes(item)) {
        return { status: 'failed', detail: text(dig(answer.body, 'items', 0, 'errors', 'message')) ?? item };
      }
      if (batch === 'DENIED' || batch === 'CANCELED') return { status: 'failed', detail: batch };
      return { status: 'pending', detail: '' };
    },

    async verifyWebhook(input) {
      if (!config.webhookId) return false;
      const header = (name: string) => input.headers.get(name);
      const fields = {
        auth_algo: header('paypal-auth-algo'),
        cert_url: header('paypal-cert-url'),
        transmission_id: header('paypal-transmission-id'),
        transmission_sig: header('paypal-transmission-sig'),
        transmission_time: header('paypal-transmission-time'),
      };
      if (Object.values(fields).some((value) => !value)) return false;

      let event: unknown;
      try {
        event = JSON.parse(input.body);
      } catch {
        return false;
      }

      const answer = await call('POST', '/v1/notifications/verify-webhook-signature', {
        body: { ...fields, webhook_id: config.webhookId, webhook_event: event },
      });
      return ok(answer) && dig(answer.body, 'verification_status') === 'SUCCESS';
    },
  };
}
