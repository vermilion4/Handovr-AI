import type { NotificationKind } from './messages';

/** Tells the people on a milestone that something happened to it. */
export type Notice = (kind: NotificationKind, milestoneId: string) => Promise<void>;

export const noNotice: Notice = async () => undefined;

/** Starts a notice without waiting for it, so slow email never holds up payments, webhooks or the tick. */
export function detached(notice: Notice): Notice {
  return async (kind, milestoneId) => {
    void notice(kind, milestoneId).catch((error) => console.error(`Notice ${kind} for milestone ${milestoneId} failed`, error));
  };
}

/** A notice that remembers what it was told, for tests. */
export function recordingNotice(): Notice & { told: Array<[NotificationKind, string]> } {
  const told: Array<[NotificationKind, string]> = [];
  const notice = async (kind: NotificationKind, milestoneId: string) => {
    told.push([kind, milestoneId]);
  };
  return Object.assign(notice, { told });
}
