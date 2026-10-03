import { holdTotalCents } from '../domain/hold';
import type { MilestoneState } from '../domain/milestone-state';
import type { HoldStatus } from '../domain/payments';
import { holds, milestones, projects, users, type Db } from '../db/schema';
import { GatewayError, type PaymentGateway } from './gateway';

type Method = keyof PaymentGateway;

export interface FakeGateway extends PaymentGateway {
  calls: Array<{ method: Method; input: unknown }>;
  /** Makes the next call to `method` throw. Call again to queue more failures. */
  failNext(method: Method, error?: Error): void;
  callsTo(method: Method): unknown[];
  authorizeResult: { authorizationId: string; expiresAt: Date } | { declined: string };
  authorizationState: 'active' | 'captured' | 'voided' | 'other';
  payoutState: { status: 'pending' | 'success' | 'failed'; detail: string };
  webhookValid: boolean;
}

/** A gateway that records every call and answers as configured, for tests. */
export function fakeGateway(): FakeGateway {
  const failures = new Map<Method, Error[]>();
  let counter = 0;

  const gateway: FakeGateway = {
    calls: [],
    authorizeResult: { authorizationId: 'AUTH-1', expiresAt: new Date('2026-10-31T12:00:00Z') },
    authorizationState: 'active',
    payoutState: { status: 'pending', detail: '' },
    webhookValid: true,

    failNext(method, error = new GatewayError('PayPal could not be reached', 0)) {
      failures.set(method, [...(failures.get(method) ?? []), error]);
    },
    callsTo(method) {
      return gateway.calls.filter((call) => call.method === method).map((call) => call.input);
    },

    async createHoldOrder(input) {
      record('createHoldOrder', input);
      return { orderId: `ORDER-${++counter}`, approveUrl: `https://paypal.test/approve/ORDER-${counter}` };
    },
    async authorizeOrder(input) {
      record('authorizeOrder', input);
      return gateway.authorizeResult;
    },
    async reauthorize(input) {
      record('reauthorize', input);
      return { authorizationId: `${input.authorizationId}-R`, expiresAt: new Date('2026-11-24T12:00:00Z') };
    },
    async capture(input) {
      record('capture', input);
      return { captureId: `CAPTURE-${++counter}` };
    },
    async voidAuthorization(authorizationId) {
      record('voidAuthorization', authorizationId);
    },
    async authorizationStatus(authorizationId) {
      record('authorizationStatus', authorizationId);
      return gateway.authorizationState;
    },
    async sendPayout(input) {
      record('sendPayout', input);
      return { payoutBatchId: `BATCH-${++counter}` };
    },
    async payoutStatus(payoutBatchId) {
      record('payoutStatus', payoutBatchId);
      return gateway.payoutState;
    },
    async verifyWebhook(input) {
      record('verifyWebhook', input.body);
      return gateway.webhookValid;
    },
  };

  function record(method: Method, input: unknown) {
    gateway.calls.push({ method, input });
    const error = failures.get(method)?.shift();
    if (error) throw error;
  }

  return gateway;
}

export interface MilestoneFixture {
  clientId: string;
  freelancerId: string;
  strangerId: string;
  projectId: string;
  milestoneId: string;
  holdId: string | null;
}

/** One project with one 600.00 milestone in the given state, and an active hold unless told otherwise. */
export async function setupMilestone(
  db: Db,
  options: {
    state: MilestoneState;
    hold?: HoldStatus | null;
    simulated?: boolean;
    authorizedAt?: Date;
    milestone?: Partial<typeof milestones.$inferInsert>;
  },
): Promise<MilestoneFixture> {
  const stamp = crypto.randomUUID().slice(0, 8);
  const person = async (name: string, role: 'client' | 'freelancer') => {
    const email = `${name.split(' ')[0].toLowerCase()}-${stamp}@example.com`;
    const [row] = await db.insert(users).values({ name, email, role }).returning({ id: users.id });
    return row.id;
  };
  const clientId = await person('Maya Chen', 'client');
  const freelancerId = await person('Tomás Rivera', 'freelancer');
  const strangerId = await person('Sam Stranger', 'client');

  const [project] = await db
    .insert(projects)
    .values({ clientId, freelancerId, title: "Chen's Bakery website" })
    .returning({ id: projects.id });
  const [milestone] = await db
    .insert(milestones)
    .values({
      projectId: project.id,
      position: 1,
      title: 'Contact page',
      amountCents: 60000,
      state: options.state,
      criteriaDraft: 'ready',
      ...options.milestone,
    })
    .returning({ id: milestones.id });

  let holdId: string | null = null;
  const status = options.hold === undefined ? 'active' : options.hold;
  if (status) {
    const authorizedAt = options.authorizedAt ?? new Date('2026-10-02T12:00:00Z');
    const [hold] = await db
      .insert(holds)
      .values({
        milestoneId: milestone.id,
        requestId: crypto.randomUUID(),
        paypalOrderId: 'ORDER-0',
        authorizationId: status === 'awaiting_approval' ? null : 'AUTH-0',
        amountCents: 60000,
        totalCents: holdTotalCents(60000),
        status,
        simulated: options.simulated ?? false,
        authorizedAt: status === 'awaiting_approval' ? null : authorizedAt,
        expiresAt: status === 'awaiting_approval' ? null : new Date(authorizedAt.getTime() + 29 * 24 * 60 * 60 * 1000),
      })
      .returning({ id: holds.id });
    holdId = hold.id;
  }

  return { clientId, freelancerId, strangerId, projectId: project.id, milestoneId: milestone.id, holdId };
}
