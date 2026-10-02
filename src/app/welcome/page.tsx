import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionSecret } from '@/auth/current-user';
import { PENDING_SIGNUP_COOKIE, decodePendingSignup } from '@/auth/pending-signup';
import { Icon } from '@/components/icon';
import { Logo } from '@/components/logo';
import { chooseRole } from './actions';

const CHOICES = [
  {
    role: 'client',
    icon: 'storefront',
    title: 'I am hiring someone',
    detail: 'You describe the work, fund each milestone, and the payment is released when the work passes.',
  },
  {
    role: 'freelancer',
    icon: 'code',
    title: 'I am doing the work',
    detail: 'Clients add you by this PayPal email. You sign the checks, deliver, and get paid here.',
  },
] as const;

export default async function WelcomePage() {
  const identity = decodePendingSignup((await cookies()).get(PENDING_SIGNUP_COOKIE)?.value, sessionSecret());
  if (!identity) redirect('/sign-in');

  return (
    <main className="mx-auto flex min-h-screen max-w-[760px] flex-col justify-center px-4 py-12">
      <Logo />
      <h1 className="mt-10 font-display text-[28px] font-medium md:text-4xl">
        Welcome, {identity.name.split(' ')[0]}. How will you use Handovr?
      </h1>
      <p className="mt-3 max-w-[60ch] text-muted">
        This sets up {identity.email} as one or the other. It cannot be changed later, and the same PayPal account
        cannot be both.
      </p>

      <form action={chooseRole} className="mt-8 grid gap-4 md:grid-cols-2">
        {CHOICES.map((choice) => (
          <button
            key={choice.role}
            type="submit"
            name="role"
            value={choice.role}
            className="rounded-2xl bg-white p-6 text-left ring-[1.5px] ring-line hover:ring-paypal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paypal"
          >
            <span className="grid size-12 place-items-center rounded-full bg-tint text-paypal">
              <Icon name={choice.icon} size={26} />
            </span>
            <span className="mt-5 block font-display text-xl font-medium">{choice.title}</span>
            <span className="mt-2 block text-sm text-muted">{choice.detail}</span>
          </button>
        ))}
      </form>
    </main>
  );
}
