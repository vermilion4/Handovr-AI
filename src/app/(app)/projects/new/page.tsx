import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/auth/current-user';
import { TopNav } from '@/components/top-nav';
import { NewProjectForm } from './new-project-form';

const NEXT_STEPS = [
  ['Handovr drafts a checklist for each milestone', 'Each brief becomes a list of checks, each with a test you can read.'],
  ['You and the freelancer both sign', 'Either of you can edit a list first. Signing freezes it.'],
  ['You fund one milestone at a time', "PayPal holds that milestone's amount. It is released when the work passes."],
] as const;

export default async function NewProjectPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');
  if (user.role !== 'client') redirect('/projects');

  return (
    <>
      <TopNav user={user} active="projects" />
      <main className="mx-auto max-w-[1440px] px-4 pb-16 pt-6 md:px-24 md:pt-8">
        <Link href="/projects" className="text-[13px] text-muted hover:text-ink">
          Projects
        </Link>
        <h1 className="mt-2 font-display text-2xl font-medium md:text-[28px]">New project</h1>

        <div className="mt-6 grid gap-10 xl:grid-cols-[minmax(0,760px)_320px]">
          <NewProjectForm />
          <aside className="xl:pt-2">
            <h2 className="font-display text-lg font-medium">What happens next</h2>
            <ol className="mt-5 space-y-6">
              {NEXT_STEPS.map(([title, detail], index) => (
                <li key={title} className="grid grid-cols-[2rem_1fr]">
                  <span className="font-display text-lg font-medium text-paypal">{index + 1}</span>
                  <div>
                    <p className="font-semibold">{title}</p>
                    <p className="mt-1 max-w-[36ch] text-[13px] text-muted">{detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      </main>
    </>
  );
}
