import { after } from 'next/server';
import type { Db } from '../db/schema';
import type { NotificationKind } from './messages';
import { detached, type Notice } from './notice';
import { notify } from './notify';
import { liveMailer } from './zapier';

function appUrl(): string {
  return process.env.APP_URL ?? 'http://127.0.0.1:3000';
}

/** Emails both people on a milestone with the live mailer. */
export function liveNotice(db: Db): Notice {
  return detached((kind, milestoneId) => notify(db, liveMailer(), { kind, milestoneId, to: 'both', now: new Date(), appUrl: appUrl() }));
}

/** Sends a notification after the response, so an action never waits for email. */
export function notifyLater(db: Db, input: { kind: NotificationKind; milestoneId: string; to: 'client' | 'freelancer' | 'both' }): void {
  after(() => notify(db, liveMailer(), { ...input, now: new Date(), appUrl: appUrl() }));
}
