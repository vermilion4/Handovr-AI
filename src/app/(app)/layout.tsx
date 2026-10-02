import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/auth/current-user';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await getCurrentUser())) redirect('/sign-in');
  return <>{children}</>;
}
