import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { holds, milestones, webhookEvents, type Db } from '../db/schema';
import { createTestDb } from '../db/test-db';
import { applyEvent } from './milestone-events';
import { processPayments } from './processor';
import { fakeGateway, setupMilestone, type FakeGateway } from './testing';
import { handleWebhook } from './webhooks';

const now = new Date('2026-10-10T12:00:00Z');
const headers = new Headers();
let db: Db;
let gateway: FakeGateway;

beforeEach(async () => {
  db = await createTestDb();
  gateway = fakeGateway();
});

const send = (event: object) => handleWebhook(db, gateway, { headers, body: JSON.stringify(event), now });
const stateOf = async (id: string) => (await db.select().from(milestones).where(eq(milestones.id, id)))[0].state;

describe('handleWebhook', () => {
  it('rejects a webhook whose signature PayPal does not confirm, and stores nothing', async () => {
    gateway.webhookValid = false;
    expect(await send({ id: 'WH-1', event_type: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED' })).toBe('rejected');
    expect(await db.select().from(webhookEvents)).toEqual([]);
  });

  it('rejects a body that is not an event', async () => {
    expect(await handleWebhook(db, gateway, { headers, body: 'not json', now })).toBe('rejected');
    expect(await send({ event_type: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED' })).toBe('rejected');
  });

  it('re-reads sent payouts when a payout event arrives, and releases the milestone', async () => {
    const { milestoneId } = await setupMilestone(db, { state: 'client_review' });
    await applyEvent(db, milestoneId, { type: 'client_approved' }, { now });
    await processPayments(db, gateway, now);
    gateway.payoutState = { status: 'success', detail: '' };

    expect(await send({ id: 'WH-2', event_type: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED', resource: {} })).toBe('handled');
    expect(await stateOf(milestoneId)).toBe('released');
  });

  it('handles each event once', async () => {
    expect(await send({ id: 'WH-3', event_type: 'PAYMENT.PAYOUTSBATCH.SUCCESS' })).toBe('handled');
    expect(await send({ id: 'WH-3', event_type: 'PAYMENT.PAYOUTSBATCH.SUCCESS' })).toBe('duplicate');
    expect(gateway.callsTo('verifyWebhook')).toHaveLength(2);
    expect(await db.select().from(webhookEvents)).toHaveLength(1);
  });

  it('marks a hold invalid when PayPal confirms it was voided from outside', async () => {
    const { milestoneId, holdId } = await setupMilestone(db, { state: 'funded' });
    gateway.authorizationState = 'voided';
    expect(await send({ id: 'WH-4', event_type: 'PAYMENT.AUTHORIZATION.VOIDED', resource: { id: 'AUTH-0' } })).toBe('handled');
    expect(await stateOf(milestoneId)).toBe('funding_problem');
    expect((await db.select().from(holds).where(eq(holds.id, holdId!)))[0].status).toBe('invalid');
  });

  it('does not trust the webhook alone: a hold PayPal still shows as active is left alone', async () => {
    const { milestoneId } = await setupMilestone(db, { state: 'funded' });
    expect(await send({ id: 'WH-5', event_type: 'PAYMENT.AUTHORIZATION.VOIDED', resource: { id: 'AUTH-0' } })).toBe('ignored');
    expect(await stateOf(milestoneId)).toBe('funded');
  });

  it('ignores a void that Handovr asked for itself, and events it has no use for', async () => {
    const { milestoneId } = await setupMilestone(db, { state: 'settlement_proposed' });
    await applyEvent(db, milestoneId, { type: 'settlement_declined' }, { now });
    gateway.authorizationState = 'voided';
    expect(await send({ id: 'WH-6', event_type: 'PAYMENT.AUTHORIZATION.VOIDED', resource: { id: 'AUTH-0' } })).toBe('ignored');
    expect(await stateOf(milestoneId)).toBe('cancelled');
    expect(await send({ id: 'WH-7', event_type: 'CUSTOMER.DISPUTE.CREATED' })).toBe('ignored');
  });

  it('lets PayPal send the event again when acting on it failed', async () => {
    const { milestoneId } = await setupMilestone(db, { state: 'funded' });
    gateway.authorizationState = 'voided';
    gateway.failNext('authorizationStatus');
    const event = { id: 'WH-8', event_type: 'PAYMENT.AUTHORIZATION.VOIDED', resource: { id: 'AUTH-0' } };

    await expect(send(event)).rejects.toThrow();
    expect(await send(event)).toBe('handled');
    expect(await stateOf(milestoneId)).toBe('funding_problem');
  });
});
