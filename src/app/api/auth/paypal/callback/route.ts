import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionSecret, startSession } from '@/auth/current-user';
import { PAYPAL_STATE_COOKIE, fetchPayPalIdentity } from '@/auth/paypal-login';
import { PENDING_SIGNUP_COOKIE, encodePendingSignup } from '@/auth/pending-signup';
import { db } from '@/db/client';
import { signInPayPalUser } from '@/db/queries/users';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const jar = await cookies();
  const expectedState = jar.get(PAYPAL_STATE_COOKIE)?.value;
  jar.delete(PAYPAL_STATE_COOKIE);

  const code = params.get('code');
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!code || !expectedState || params.get('state') !== expectedState || !clientId || !clientSecret) {
    redirect('/sign-in?error=paypal');
  }

  const identity = await fetchPayPalIdentity({ code, clientId, clientSecret }).catch(() => null);
  if (!identity) redirect('/sign-in?error=paypal');

  const userId = await signInPayPalUser(db, identity);
  if (userId) {
    await startSession(userId);
    redirect('/projects');
  }

  // Someone new: hold their PayPal identity until they say how they will use Handovr.
  jar.set(PENDING_SIGNUP_COOKIE, encodePendingSignup(identity, sessionSecret()), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 900,
  });
  redirect('/welcome');
}
