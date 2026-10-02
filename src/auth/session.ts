import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'handovr_session';

function signature(userId: string, secret: string): string {
  return createHmac('sha256', secret).update(userId).digest('hex');
}

/** The cookie value for a signed-in user: "<userId>.<hmac>". */
export function signSession(userId: string, secret: string): string {
  return `${userId}.${signature(userId, secret)}`;
}

export function verifySession(token: string | undefined, secret: string): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [userId, given] = parts;
  if (!userId || !/^[0-9a-f]{64}$/.test(given)) return null;

  const expected = Buffer.from(signature(userId, secret), 'hex');
  const actual = Buffer.from(given, 'hex');
  return timingSafeEqual(expected, actual) ? userId : null;
}
