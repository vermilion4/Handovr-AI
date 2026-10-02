import { eq } from 'drizzle-orm';
import type { PayPalIdentity } from '../../auth/paypal-login';
import { users, type Db } from '../schema';

/** The id of the account with this PayPal email, refreshed with the PayPal name and payer id. Null if there is none. */
export async function signInPayPalUser(db: Db, identity: PayPalIdentity): Promise<string | null> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, identity.email)).limit(1);
  if (!existing) return null;

  await db
    .update(users)
    .set({ name: identity.name, paypalPayerId: identity.payerId })
    .where(eq(users.id, existing.id));
  return existing.id;
}

export async function createPayPalUser(
  db: Db,
  identity: PayPalIdentity,
  role: 'client' | 'freelancer',
): Promise<string> {
  const existing = await signInPayPalUser(db, identity);
  if (existing) return existing;

  const [created] = await db
    .insert(users)
    .values({ name: identity.name, email: identity.email, role, paypalPayerId: identity.payerId })
    .returning({ id: users.id });
  return created.id;
}

export const CLIENT_AS_FREELANCER =
  'That email belongs to a client account, so it cannot be invited as a freelancer. Ask them for a different PayPal email.';

export async function freelancerEmailProblem(db: Db, email: string): Promise<string | null> {
  const [existing] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  return existing?.role === 'client' ? CLIENT_AS_FREELANCER : null;
}
