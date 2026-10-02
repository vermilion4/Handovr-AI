import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { DraftStatus } from '../domain/contract';
import type { CriterionCategory, CriterionKind } from '../domain/criteria';
import type { MilestoneState } from '../domain/milestone-state';

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

export const schema = { users, projects, milestones, criteriaVersions, criteria, signatures };

/** Either the app's Postgres connection or the in-memory test database. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
