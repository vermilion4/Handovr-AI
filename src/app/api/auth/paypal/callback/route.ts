const BASE = 'https://api-m.sandbox.paypal.com';

// Temporary probe: exchanges the login code and shows what PayPal returns.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const code = params.get('code');
  if (!code) {
    return Response.json({ error: params.get('error'), description: params.get('error_description') });
  }

  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const tokenRes = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code }),
  });
  const token = await tokenRes.json();
  if (!token.access_token) {
    return Response.json({ step: 'token', status: tokenRes.status, error: token.error, description: token.error_description });
  }

  const infoRes = await fetch(`${BASE}/v1/identity/openidconnect/userinfo?schema=openid`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  return Response.json({
    tokenFields: Object.keys(token),
    scope: token.scope,
    userinfoStatus: infoRes.status,
    userinfo: await infoRes.json(),
  });
}
