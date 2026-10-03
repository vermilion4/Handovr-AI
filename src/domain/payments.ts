export type HoldStatus = 'awaiting_approval' | 'active' | 'captured' | 'voided' | 'expired' | 'invalid' | 'abandoned';

export type PaymentType = 'hold' | 'renew' | 'capture' | 'payout' | 'void';

/** `blocked` waits on another row; `pending` is ready to send; `sending` is mid-call; `sent` awaits PayPal's result. */
export type PaymentStatus = 'blocked' | 'pending' | 'sending' | 'sent' | 'completed' | 'failed';
