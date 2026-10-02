import type { PayPalIdentity } from './paypal-login';
import { signSession, verifySession } from './session';

export const PENDING_SIGNUP_COOKIE = 'handovr_pending_signup';

const PREFIX = 'signup-';

/** The PayPal identity of someone who has logged in but not yet chosen a role, as a signed cookie value. */
export function encodePendingSignup(identity: PayPalIdentity, secret: string): string {
  const payload = Buffer.from(JSON.stringify(identity)).toString('base64url');
  return signSession(`${PREFIX}${payload}`, secret);
}

export function decodePendingSignup(token: string | undefined, secret: string): PayPalIdentity | null {
  const signed = verifySession(token, secret);
  if (!signed?.startsWith(PREFIX)) return null;

  try {
    const value = JSON.parse(Buffer.from(signed.slice(PREFIX.length), 'base64url').toString('utf8'));
    const { name, email, payerId } = value ?? {};
    if (typeof name !== 'string' || typeof email !== 'string' || typeof payerId !== 'string') return null;
    return { name, email, payerId };
  } catch {
    return null;
  }
}
