import Image from 'next/image';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/auth/current-user';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { Logo } from '@/components/logo';
import { signInAsDemo } from './actions';

const POINTS = [
  ['handshake', 'Agree what done looks like, as a checklist you both sign'],
  ['lock', 'PayPal holds the payment while the work is done'],
  ['smart_toy', 'An AI tester checks the finished site against the list'],
] as const;

export default async function SignInPage() {
  if (await getCurrentUser()) redirect('/projects');

  return (
    <main className="grid min-h-screen bg-white md:grid-cols-[4fr_5fr]">
      <section className="relative isolate flex flex-col justify-between gap-16 overflow-hidden px-6 py-8 text-white md:px-20 md:py-20">
        <Image src="/signin-photo.jpg" alt="" fill priority sizes="(min-width: 768px) 45vw, 100vw" className="-z-20 object-cover" />
        <div className="absolute inset-0 -z-10 bg-ink/[0.84]" />
        <Logo reversed />
        <div>
          <h1 className="font-display text-3xl font-medium leading-tight md:text-[46px]">
            Payment that releases when the work passes.
          </h1>
          <ul className="mt-8 space-y-4">
            {POINTS.map(([icon, text]) => (
              <li key={icon} className="flex items-center gap-3 text-sm md:text-[17px]">
                <Icon name={icon} size={24} className="text-hold" />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <span />
      </section>

      <section className="flex items-center px-6 py-10 md:px-[180px]">
        <div className="w-full max-w-[440px]">
          <h2 className="font-display text-[28px] font-medium md:text-4xl">Sign in</h2>
          <p className="mt-3 text-muted">Look around with a demo account.</p>
          <form action={signInAsDemo} className="mt-8 grid gap-4 md:grid-cols-2">
            <Button variant="secondary" type="submit" name="role" value="client" className="px-4! whitespace-nowrap text-[15px]">
              Continue as a client
            </Button>
            <Button variant="secondary" type="submit" name="role" value="freelancer" className="px-4! whitespace-nowrap text-[15px]">
              Continue as a freelancer
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
