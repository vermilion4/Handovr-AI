'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionSecret, startSession } from '@/auth/current-user';
import { PENDING_SIGNUP_COOKIE, decodePendingSignup } from '@/auth/pending-signup';
import { db } from '@/db/client';
import { createPayPalUser } from '@/db/queries/users';

export async function chooseRole(formData: FormData) {
  const jar = await cookies();
  const identity = decodePendingSignup(jar.get(PENDING_SIGNUP_COOKIE)?.value, sessionSecret());
  if (!identity) redirect('/sign-in?error=paypal');

  const role = formData.get('role');
  if (role !== 'client' && role !== 'freelancer') redirect('/welcome');

  const userId = await createPayPalUser(db, identity, role);
  jar.delete(PENDING_SIGNUP_COOKIE);
  await startSession(userId);
  redirect('/projects');
}
