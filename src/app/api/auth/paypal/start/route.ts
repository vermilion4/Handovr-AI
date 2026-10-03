import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PAYPAL_STATE_COOKIE, appUrl, paypalAuthorizeUrl, paypalRedirectUri } from '@/auth/paypal-login';

export async function GET(request: Request) {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  if (!clientId) redirect('/sign-in?error=paypal');

  // The state cookie must be set on the same host PayPal sends the person back to.
  if (request.headers.get('host') !== new URL(appUrl()).host) redirect(`${appUrl()}/api/auth/paypal/start`);

  const state = randomUUID();
  (await cookies()).set(PAYPAL_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  redirect(paypalAuthorizeUrl({ clientId, redirectUri: paypalRedirectUri(), state }));
}
