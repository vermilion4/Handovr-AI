'use server';

import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionSecret } from '@/auth/current-user';
import { SESSION_COOKIE, signSession } from '@/auth/session';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { DEMO_CLIENT_EMAIL, DEMO_FREELANCER_EMAIL } from '@/db/seed-data';

export async function signInAsDemo(formData: FormData) {
  const email = formData.get('role') === 'freelancer' ? DEMO_FREELANCER_EMAIL : DEMO_CLIENT_EMAIL;
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw new Error('Demo data is missing. Run "pnpm db:seed".');

  (await cookies()).set(SESSION_COOKIE, signSession(user.id, sessionSecret()), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  redirect('/projects');
}

export async function signOut() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/sign-in');
}
