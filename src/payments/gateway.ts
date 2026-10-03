export class GatewayError extends Error {
  constructor(
    message: string,
    /** The HTTP status PayPal answered with, or 0 when it could not be reached. */
    readonly status: number,
    /** PayPal's short name for what went wrong, such as AUTHORIZATION_VOIDED. */
    readonly issue: string | null = null,
  ) {
    super(message);
  }

  /**
   * True when PayPal understood the request and refused it for good, so sending it again will not help.
   * A credentials problem or a malformed request is not one: those are ours to fix, and worth retrying.
   */
  get refused(): boolean {
    return this.status === 422 || this.status === 404;
  }
}

export interface PaymentGateway {
  createHoldOrder(input: {
    requestId: string;
    totalCents: number;
    description: string;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<{ orderId: string; approveUrl: string }>;

  /** Places the hold on an order the payer approved. `declined` carries PayPal's reason. */
  authorizeOrder(input: {
    requestId: string;
    orderId: string;
  }): Promise<{ authorizationId: string; expiresAt: Date } | { declined: string }>;

  reauthorize(input: {
    requestId: string;
    authorizationId: string;
    totalCents: number;
  }): Promise<{ authorizationId: string; expiresAt: Date }>;

  /** Captures part or all of a hold and releases whatever is left of it. */
  capture(input: {
    requestId: string;
    authorizationId: string;
    amountCents: number;
    note: string;
  }): Promise<{ captureId: string }>;

  voidAuthorization(authorizationId: string): Promise<void>;

  authorizationStatus(authorizationId: string): Promise<'active' | 'captured' | 'voided' | 'other'>;

  /** Sends one payout. A batch id that was already used returns the earlier batch. */
  sendPayout(input: {
    batchId: string;
    email: string;
    amountCents: number;
    note: string;
  }): Promise<{ payoutBatchId: string }>;

  payoutStatus(payoutBatchId: string): Promise<{ status: 'pending' | 'success' | 'failed'; detail: string }>;

  verifyWebhook(input: { headers: Headers; body: string }): Promise<boolean>;
}
