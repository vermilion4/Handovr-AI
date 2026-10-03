import { headers } from 'next/headers';
import { appUrl } from '@/auth/paypal-login';

/** The address PayPal should send the person back to: the one they are using now, or APP_URL once deployed. */
export async function requestOrigin(): Promise<string> {
  if (process.env.NODE_ENV === 'production') return appUrl();
  const host = (await headers()).get('host');
  return host ? `http://${host}` : appUrl();
}
