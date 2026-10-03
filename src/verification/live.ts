import Anthropic from '@anthropic-ai/sdk';
import type { Db } from '../db/schema';
import { reviewWindowSeconds } from '../domain/verification';
import { liveGateway } from '../payments/live';
import { processPayments } from '../payments/processor';
import { openKernelBrowser } from './browser';
import type { VerificationDeps } from './run';

export function verifyModel(): string {
  return process.env.HANDOVR_VERIFY_MODEL ?? process.env.HANDOVR_MODEL ?? 'claude-sonnet-5-5';
}

/** Real KERNEL browsers and Claude, for runs started by the app or the tick. */
export function liveVerificationDeps(db: Db): VerificationDeps {
  const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });
  return {
    openBrowser: openKernelBrowser,
    createMessage: (params) => client.messages.create(params),
    model: verifyModel(),
    now: () => new Date(),
    reviewWindowSeconds: reviewWindowSeconds(process.env.REVIEW_WINDOW_SECONDS),
    onRelease: () => processPayments(db, liveGateway(), new Date()),
  };
}
