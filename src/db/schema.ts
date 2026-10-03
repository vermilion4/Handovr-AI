import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { boolean, customType, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { HoldStatus, PaymentStatus, PaymentType } from '../domain/payments';
import type { DraftStatus } from '../domain/contract';
import type { CriterionCategory, CriterionKind } from '../domain/criteria';
import type { MilestoneState } from '../domain/milestone-state';
import type { AiVerdict, ClientDecision } from '../domain/verification';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** PayPal email, where payouts are sent. */
  email: text('email').notNull().unique(),
  role: text('role').$type<'client' | 'freelancer'>().notNull(),
  paypalPayerId: text('paypal_payer_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull().references(() => users.id),
  freelancerId: uuid('freelancer_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

export const milestones = pgTable('milestones', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  /** 1-based order within the project. */
  position: integer('position').notNull(),
  title: text('title').notNull(),
  brief: text('brief').notNull().default(''),
  amountCents: integer('amount_cents').notNull(),
  state: text('state').$type<MilestoneState>().notNull().default('drafting'),
  criteriaDraft: text('criteria_draft').$type<DraftStatus>().notNull().default('pending'),
  /** When drafting was last queued or picked up. */
  criteriaDraftStartedAt: timestamp('criteria_draft_started_at', { withTimezone: true }),
  attemptsUsed: integer('attempts_used').notNull().default(0),
  reviewDueAt: timestamp('review_due_at', { withTimezone: true }),
  /** The state the current submission was made from. */
  submittedFrom: text('submitted_from').$type<'funded' | 'revision'>(),
  releaseKind: text('release_kind').$type<'full' | 'split'>(),
  /** The state to go back to once a funding problem is fixed. */
  returnTo: text('return_to').$type<MilestoneState>(),
  /** The freelancer's share when a split was agreed. */
  splitFreelancerCents: integer('split_freelancer_cents'),
  /** The cancelled or lapsed milestone this one starts again. */
  restartedFromId: uuid('restarted_from_id'),
});

export const criteriaVersions = pgTable(
  'criteria_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    milestoneId: uuid('milestone_id').notNull().references(() => milestones.id),
    /** 1 for Handovr's draft, then one higher for each change. */
    version: integer('version').notNull(),
    /** Null when Handovr drafted the list. */
    authorId: uuid('author_id').references(() => users.id),
    reason: text('reason').notNull().default(''),
    /** When the other person accepted a change they did not write. */
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.milestoneId, table.version)],
);

export const criteria = pgTable('criteria', {
  id: uuid('id').primaryKey().defaultRandom(),
  versionId: uuid('version_id').notNull().references(() => criteriaVersions.id),
  /** The same check keeps its key from one version to the next. */
  key: uuid('key').notNull(),
  position: integer('position').notNull(),
  description: text('description').notNull(),
  testPlan: text('test_plan').notNull(),
  kind: text('kind').$type<CriterionKind>().notNull(),
  category: text('category').$type<CriterionCategory>(),
  shareCents: integer('share_cents').notNull(),
});

export const signatures = pgTable(
  'signatures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    versionId: uuid('version_id').notNull().references(() => criteriaVersions.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    signedName: text('signed_name').notNull(),
    signedEmail: text('signed_email').notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.versionId, table.userId)],
);

export const holds = pgTable('holds', {
  id: uuid('id').primaryKey().defaultRandom(),
  milestoneId: uuid('milestone_id').notNull().references(() => milestones.id),
  /** Sent to PayPal as the idempotency key when the order is created. */
  requestId: uuid('request_id').notNull(),
  paypalOrderId: text('paypal_order_id').notNull(),
  authorizationId: text('authorization_id'),
  /** The milestone amount this hold covers. */
  amountCents: integer('amount_cents').notNull(),
  /** The amount held: the milestone amount plus PayPal's fee. */
  totalCents: integer('total_cents').notNull(),
  status: text('status').$type<HoldStatus>().notNull().default('awaiting_approval'),
  /** Demo data only: money events complete without calling PayPal. */
  simulated: boolean('simulated').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  authorizedAt: timestamp('authorized_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  renewedAt: timestamp('renewed_at', { withTimezone: true }),
});

export const paymentEvents = pgTable('payment_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  milestoneId: uuid('milestone_id').notNull().references(() => milestones.id),
  holdId: uuid('hold_id').notNull().references(() => holds.id),
  type: text('type').$type<PaymentType>().notNull(),
  status: text('status').$type<PaymentStatus>().notNull(),
  amountCents: integer('amount_cents').notNull(),
  /** Sent to PayPal as the idempotency key, or as the payout batch id. */
  requestId: uuid('request_id').notNull().defaultRandom(),
  /** PayPal's id for the authorisation, capture or payout batch. */
  paypalId: text('paypal_id'),
  detail: text('detail').notNull().default(''),
  attempts: integer('attempts').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const webhookEvents = pgTable('webhook_events', {
  paypalEventId: text('paypal_event_id').primaryKey(),
  eventType: text('event_type').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

const bytes = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return 'bytea';
  },
});

export type SubmissionStatus = 'queued' | 'running' | 'passed' | 'failed' | 'unreachable';

export const submissions = pgTable('submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  milestoneId: uuid('milestone_id').notNull().references(() => milestones.id),
  /** 1 for the first submission of the milestone, then one higher each time. */
  attempt: integer('attempt').notNull(),
  url: text('url').notNull(),
  repoUrl: text('repo_url'),
  status: text('status').$type<SubmissionStatus>().notNull().default('queued'),
  /** How many times a run has been started for this submission. */
  tries: integer('tries').notNull().default(0),
  /** Demo data only: never run. */
  simulated: boolean('simulated').notNull().default(false),
  currentCriterionId: uuid('current_criterion_id'),
  progressNote: text('progress_note').notNull().default(''),
  /** When the run last showed it was alive. */
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
  replayUrl: text('replay_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

export const verdicts = pgTable(
  'verdicts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id').notNull().references(() => submissions.id),
    criterionId: uuid('criterion_id').notNull().references(() => criteria.id),
    source: text('source').$type<'ai' | 'client'>().notNull(),
    verdict: text('verdict').$type<AiVerdict | ClientDecision>().notNull(),
    summary: text('summary').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.submissionId, table.criterionId, table.source)],
);

export const evidence = pgTable('evidence', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id').notNull().references(() => submissions.id),
  /** Null for evidence about the whole run, such as the first screenshots. */
  verdictId: uuid('verdict_id').references(() => verdicts.id),
  kind: text('kind').$type<'screenshot' | 'note' | 'timing' | 'console'>().notNull(),
  caption: text('caption').notNull().default(''),
  text: text('text').notNull().default(''),
  image: bytes('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const settlements = pgTable('settlements', {
  id: uuid('id').primaryKey().defaultRandom(),
  milestoneId: uuid('milestone_id').notNull().references(() => milestones.id),
  submissionId: uuid('submission_id').references(() => submissions.id),
  freelancerCents: integer('freelancer_cents').notNull(),
  clientCents: integer('client_cents').notNull(),
  explanation: text('explanation').notNull(),
  clientResponse: text('client_response').$type<'accepted' | 'declined'>(),
  freelancerResponse: text('freelancer_response').$type<'accepted' | 'declined'>(),
  outcome: text('outcome').$type<'pending' | 'accepted' | 'declined' | 'timed_out' | 'cancelled'>().notNull().default('pending'),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  milestoneId: uuid('milestone_id').notNull().references(() => milestones.id),
  kind: text('kind').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  status: text('status').$type<'sent' | 'logged' | 'failed'>().notNull(),
  detail: text('detail').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const aiUsage = pgTable('ai_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  kind: text('kind').$type<'draft' | 'rewrite' | 'verify'>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const schema = {
  users,
  projects,
  milestones,
  criteriaVersions,
  criteria,
  signatures,
  holds,
  paymentEvents,
  webhookEvents,
  submissions,
  verdicts,
  evidence,
  settlements,
  notifications,
  aiUsage,
};

/** Either the app's Postgres connection or the in-memory test database. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
