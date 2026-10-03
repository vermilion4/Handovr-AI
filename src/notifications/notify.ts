import { eq } from 'drizzle-orm';
import { milestones, notifications, projects, users, type Db } from '../db/schema';
import { formatMoney } from '../domain/money';
import { paidCents } from '../domain/settlement';
import { notificationFor, type NotificationKind } from './messages';

export interface Mailer {
  send(message: { to: string; subject: string; body: string }): Promise<void>;
}

/** Writes notifications to the server log, used when Zapier is not configured. */
export const logMailer: Mailer = {
  async send(message) {
    console.log(`Notification to ${message.to}: ${message.subject}`);
  },
};

/** Tells the people on a milestone what happened. Never throws: a failed email must not undo the action. */
export async function notify(
  db: Db,
  mailer: Mailer,
  input: { kind: NotificationKind; milestoneId: string; to: 'client' | 'freelancer' | 'both'; now: Date; appUrl: string },
): Promise<void> {
  try {
    const [row] = await db
      .select({ milestone: milestones, project: projects })
      .from(milestones)
      .innerJoin(projects, eq(projects.id, milestones.projectId))
      .where(eq(milestones.id, input.milestoneId));
    if (!row) return;
    const [client] = await db.select().from(users).where(eq(users.id, row.project.clientId));
    const [freelancer] = await db.select().from(users).where(eq(users.id, row.project.freelancerId));
    const amountCents = paidCents(row.milestone);
    const link = `${input.appUrl.replace(/\/$/, '')}/projects/${row.project.id}/milestones/${row.milestone.id}`;
    const sides = input.to === 'both' ? (['client', 'freelancer'] as const) : [input.to];
    const inbox = process.env.NOTIFY_INBOX;

    for (const side of sides) {
      const person = side === 'client' ? client : freelancer;
      const other = side === 'client' ? freelancer : client;
      const message = notificationFor(input.kind, {
        to: side,
        otherFirst: other.name.split(' ')[0],
        projectTitle: row.project.title,
        milestoneTitle: row.milestone.title,
        amountText: formatMoney(amountCents),
        link,
      });
      // In the demo every email goes to one real inbox, since sandbox addresses are made up.
      const body = inbox ? `For ${person.name} (${person.email}):\n\n${message.body}` : message.body;

      let status: 'sent' | 'logged' | 'failed' = mailer === logMailer ? 'logged' : 'sent';
      let detail = '';
      try {
        await mailer.send({ to: inbox || person.email, subject: message.subject, body });
      } catch (error) {
        status = 'failed';
        detail = error instanceof Error ? error.message : String(error);
        console.error(`Notification ${input.kind} to ${person.id} failed`, error);
      }
      await db.insert(notifications).values({
        userId: person.id,
        milestoneId: row.milestone.id,
        kind: input.kind,
        subject: message.subject,
        body,
        status,
        detail,
        createdAt: input.now,
      });
    }
  } catch (error) {
    console.error(`Notification ${input.kind} for milestone ${input.milestoneId} could not be prepared`, error);
  }
}
