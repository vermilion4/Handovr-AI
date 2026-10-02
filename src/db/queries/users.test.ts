import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { users, type Db } from '../schema';
import { createTestDb } from '../test-db';
import { createPayPalUser, freelancerEmailProblem, signInPayPalUser } from './users';

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

const identity = { name: 'John Freelancer', email: 'john@example.com', payerId: 'ZWYNW2PJJN4W2' };

describe('signInPayPalUser', () => {
  it('returns nothing for someone Handovr has not seen, and creates no account', async () => {
    expect(await signInPayPalUser(db, identity)).toBeNull();
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it('fills in the name and payer id of someone who was invited by email, keeping them a freelancer', async () => {
    const [invited] = await db.insert(users).values({ name: 'john', email: 'john@example.com', role: 'freelancer' }).returning({ id: users.id });
    expect(await signInPayPalUser(db, identity)).toBe(invited.id);
    const [row] = await db.select().from(users).where(eq(users.id, invited.id));
    expect(row).toMatchObject({ name: 'John Freelancer', role: 'freelancer', paypalPayerId: 'ZWYNW2PJJN4W2' });
  });
});

describe('createPayPalUser', () => {
  it('creates the account with the role the person chose', async () => {
    const id = await createPayPalUser(db, identity, 'freelancer');
    const [row] = await db.select().from(users).where(eq(users.id, id));
    expect(row).toMatchObject({ name: 'John Freelancer', email: 'john@example.com', role: 'freelancer', paypalPayerId: 'ZWYNW2PJJN4W2' });
  });

  it('keeps the existing role when the account appeared in the meantime', async () => {
    const [invited] = await db.insert(users).values({ name: 'john', email: 'john@example.com', role: 'freelancer' }).returning({ id: users.id });
    expect(await createPayPalUser(db, identity, 'client')).toBe(invited.id);
    const rows = await db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('freelancer');
  });
});

describe('freelancerEmailProblem', () => {
  it('allows an email Handovr has not seen and an existing freelancer, whatever the capitals', async () => {
    await db.insert(users).values({ name: 'Tomás Rivera', email: 'tomas@riverastudio.example', role: 'freelancer' });
    expect(await freelancerEmailProblem(db, 'new@example.com')).toBeNull();
    expect(await freelancerEmailProblem(db, ' Tomas@RiveraStudio.example ')).toBeNull();
  });

  it('refuses an email that belongs to a client account', async () => {
    await db.insert(users).values({ name: 'Maya Chen', email: 'maya@chensbakery.example', role: 'client' });
    expect(await freelancerEmailProblem(db, 'Maya@chensbakery.example')).toBe(
      'That email belongs to a client account, so it cannot be invited as a freelancer. Ask them for a different PayPal email.',
    );
  });
});
