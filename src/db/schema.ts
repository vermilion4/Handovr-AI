import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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
  /** Whether the AI has finished drafting this milestone's criteria. */
  criteriaDraft: text('criteria_draft').$type<'pending' | 'ready'>().notNull().default('pending'),
  attemptsUsed: integer('attempts_used').notNull().default(0),
  reviewDueAt: timestamp('review_due_at', { withTimezone: true }),
});

export const schema = { users, projects, milestones };

/** Either the app's Postgres connection or the in-memory test database. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
