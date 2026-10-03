import { describe, expect, it } from 'vitest';
import { fetchPayPalIdentity, paypalAuthorizeUrl } from './paypal-login';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fakeFetch(token: Response, info?: Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return calls.length === 1 ? token : info!;
  }) as typeof fetch;
  return { impl, calls };
}

const credentials = { code: 'the-code', clientId: 'client', clientSecret: 'secret' };
const profile = { name: ' John Freelancer ', email: 'John@Example.com', email_verified: true, payer_id: 'ZWYNW2PJJN4W2' };

describe('paypalAuthorizeUrl', () => {
  it('asks PayPal for the identity scopes and carries the state', () => {
    const url = new URL(paypalAuthorizeUrl({ clientId: 'client', redirectUri: 'http://127.0.0.1:3000/api/auth/paypal/callback', state: 'abc' }));
    expect(url.origin + url.pathname).toBe('https://www.sandbox.paypal.com/signin/authorize');
    expect(url.searchParams.get('client_id')).toBe('client');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('abc');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:3000/api/auth/paypal/callback');
    expect(url.searchParams.get('scope')).toBe('openid profile email https://uri.paypal.com/services/paypalattributes');
  });
});

describe('fetchPayPalIdentity', () => {
  it('exchanges the code and returns the name, lower-case email and payer id', async () => {
    const { impl, calls } = fakeFetch(json({ access_token: 'token' }), json(profile));
    expect(await fetchPayPalIdentity({ ...credentials, fetchImpl: impl })).toEqual({
      name: 'John Freelancer',
      email: 'john@example.com',
      payerId: 'ZWYNW2PJJN4W2',
    });
    expect(calls[0].url).toBe('https://api-m.sandbox.paypal.com/v1/oauth2/token');
    expect(String(calls[0].init?.body)).toBe('grant_type=authorization_code&code=the-code');
    expect(calls[1].init?.headers).toEqual({ Authorization: 'Bearer token' });
  });

  it('returns nothing when PayPal refuses the code', async () => {
    const { impl } = fakeFetch(json({ error: 'invalid_grant' }, 400));
    expect(await fetchPayPalIdentity({ ...credentials, fetchImpl: impl })).toBeNull();
  });

  it('returns nothing when the email is not confirmed or a field is missing', async () => {
    for (const info of [{ ...profile, email_verified: false }, { ...profile, payer_id: undefined }, { ...profile, name: '' }]) {
      const { impl } = fakeFetch(json({ access_token: 'token' }), json(info));
      expect(await fetchPayPalIdentity({ ...credentials, fetchImpl: impl })).toBeNull();
    }
  });
});
