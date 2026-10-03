import type { PaymentGateway } from './gateway';
import { paypalGateway } from './paypal';

let cached: PaymentGateway | null = null;

/** The PayPal sandbox gateway built from the environment. */
export function liveGateway(): PaymentGateway {
  if (cached) return cached;
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set.');
  cached = paypalGateway({ clientId, clientSecret, webhookId: process.env.PAYPAL_WEBHOOK_ID });
  return cached;
}
