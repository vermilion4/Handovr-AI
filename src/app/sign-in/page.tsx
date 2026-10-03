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

export default async function SignInPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ error?: string }> }>) {
  if (await getCurrentUser()) redirect('/projects');
  const { error } = await searchParams;

  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[4fr_5fr]">
      <section className="relative isolate flex flex-col justify-between gap-16 overflow-hidden px-6 py-8 text-white md:px-12 md:py-12 lg:px-16 lg:py-20 xl:px-20">
        <Image src="/signin-photo.jpg" alt="" fill priority sizes="(min-width: 1024px) 45vw, 100vw" className="-z-20 object-cover" />
        <div className="absolute inset-0 -z-10 bg-ink/84" />
        <Logo reversed />
        <div>
          <h1 className="font-display text-3xl font-medium leading-tight md:text-4xl xl:text-[46px]">
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

      <section className="flex items-center justify-center px-6 py-10 md:py-16 lg:px-12">
        <div className="w-full max-w-[440px]">
          <h2 className="font-display text-[28px] font-medium md:text-4xl">Sign in</h2>
          {error === 'paypal' && (
            <p role="alert" className="mt-4 rounded-xl bg-fail/10 px-4 py-3 text-sm text-fail">
              PayPal did not confirm the login. Try again, and use a PayPal account with a confirmed email.
            </p>
          )}
          <a
            href="/api/auth/paypal/start"
            className="mt-8 flex h-12 items-center justify-center rounded-full bg-hold text-base font-semibold text-ink hover:bg-[#f2b400] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paypal"
          >
            Log in with PayPal
          </a>
          <p className="mt-8 text-muted">Or look around with a demo account.</p>
          <form action={signInAsDemo} className="mt-4 grid gap-4">
            <Button variant="secondary" type="submit" name="role" value="client" className="w-full">
              Continue as a client
            </Button>
            <Button variant="secondary" type="submit" name="role" value="freelancer" className="w-full">
              Continue as a freelancer
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
