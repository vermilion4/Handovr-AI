const AUTHORIZE_URL = 'https://www.sandbox.paypal.com/signin/authorize';
const API_BASE = 'https://api-m.sandbox.paypal.com';

export const PAYPAL_STATE_COOKIE = 'handovr_paypal_state';

export function appUrl(): string {
  return (process.env.APP_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
}

export function paypalRedirectUri(): string {
  return `${appUrl()}/api/auth/paypal/callback`;
}

export function paypalAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    flowEntry: 'static',
    client_id: input.clientId,
    response_type: 'code',
    scope: 'openid profile email https://uri.paypal.com/services/paypalattributes',
    redirect_uri: input.redirectUri,
    state: input.state,
  }).toString();
  return url.toString();
}

export interface PayPalIdentity {
  name: string;
  email: string;
  payerId: string;
}

export async function fetchPayPalIdentity(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}): Promise<PayPalIdentity | null> {
  const request = input.fetchImpl ?? fetch;
  const basic = Buffer.from(`${input.clientId}:${input.clientSecret}`).toString('base64');

  const tokenResponse = await request(`${API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: input.code }).toString(),
  });
  if (!tokenResponse.ok) return null;
  const token = (await tokenResponse.json()) as { access_token?: unknown };
  if (typeof token.access_token !== 'string') return null;

  const infoResponse = await request(`${API_BASE}/v1/identity/openidconnect/userinfo?schema=openid`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!infoResponse.ok) return null;
  const info = (await infoResponse.json()) as Record<string, unknown>;

  const name = typeof info.name === 'string' ? info.name.trim() : '';
  const email = typeof info.email === 'string' ? info.email.trim().toLowerCase() : '';
  if (info.email_verified !== true || name === '' || email === '' || typeof info.payer_id !== 'string') return null;

  return { name, email, payerId: info.payer_id };
}
