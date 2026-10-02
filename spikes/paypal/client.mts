const BASE = 'https://api-m.sandbox.paypal.com';

let cached: { token: string; expiresAt: number } | null = null;

export async function getToken(): Promise<{ token: string; scopes: string[] }> {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set');

  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Token request failed: ${res.status} ${JSON.stringify(body)}`);

  cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return { token: body.access_token, scopes: String(body.scope ?? '').split(' ') };
}

export interface ApiResult {
  status: number;
  body: any;
  debugId: string | null;
}

export async function paypal(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResult> {
  const token = cached && cached.expiresAt > Date.now() + 60_000 ? cached.token : (await getToken()).token;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? JSON.parse(text) : null,
    debugId: res.headers.get('paypal-debug-id'),
  };
}
