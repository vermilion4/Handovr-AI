import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/auth/current-user';
import { Icon } from '@/components/icon';
import { AddressResultDialog } from '@/components/result-dialog';
import { TopNav } from '@/components/top-nav';
import { db } from '@/db/client';
import { getContract } from '@/db/queries/contract';
import { fundingProblemFeedback } from '@/domain/feedback';
import { holdFeeCents, holdTotalCents } from '@/domain/hold';
import { isUuid } from '@/domain/ids';
import { formatMoney } from '@/domain/money';
import { FundButton } from './fund-button';

export default async function FundPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ projectId: string; milestoneId: string }>;
  searchParams: Promise<{ problem?: string }>;
}>) {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  const { projectId, milestoneId } = await params;
  const { problem } = await searchParams;
  const contract = isUuid(projectId) ? await getContract(db, projectId, user.id) : null;
  const milestone = contract?.milestones.find((candidate) => candidate.id === milestoneId);
  if (!contract || !milestone) notFound();

  const projectHref = `/projects/${contract.project.id}`;
  const fundable = milestone.state === 'signed' || milestone.state === 'funding_problem';
  if (contract.viewerRole !== 'client' || !fundable || !milestone.version) redirect(projectHref);

  const total = holdTotalCents(milestone.amountCents);
  const problemFeedback = fundingProblemFeedback(problem);

  return (
    <>
      <TopNav user={user} active="projects" />
      <main className="mx-auto max-w-[1440px] px-4 pb-16 pt-6 md:px-24 md:pt-8">
        <p className="text-[13px] text-muted">
          <Link href={projectHref} className="hover:text-ink">
            {contract.project.title}
          </Link>{' '}
          / {milestone.title}
        </p>
        <h1 className="mt-2 font-display text-2xl font-medium md:text-[28px]">Fund {milestone.title}</h1>

        {problemFeedback && <AddressResultDialog feedback={problemFeedback} />}
        {milestone.state === 'funding_problem' && (
          <p role="alert" className="mt-5 max-w-[640px] rounded-xl bg-fail/10 px-5 py-4 text-sm text-fail">
            The earlier hold could not be collected, so nothing was paid. Fund again to release the payment.
          </p>
        )}

        <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,640px)_minmax(0,1fr)]">
          <section className="rounded-2xl bg-white p-6 md:p-10">
            <p className="flex items-center gap-2 text-[13px] font-semibold">
              <Icon name="lock" size={18} />
              Amount to hold
            </p>
            <p className="mt-2 font-display text-5xl font-medium md:text-6xl">{formatMoney(total)}</p>

            <dl className="mt-6 space-y-2 border-y border-line py-4 text-sm">
              <div className="flex justify-between">
                <dt>{milestone.title}</dt>
                <dd className="font-display font-medium">{formatMoney(milestone.amountCents)}</dd>
              </div>
              <div className="flex justify-between text-muted">
                <dt>PayPal&apos;s payment fee</dt>
                <dd className="font-display font-medium">{formatMoney(holdFeeCents(milestone.amountCents))}</dd>
              </div>
            </dl>

            <p className="mt-6 max-w-[46ch]">
              PayPal places a hold for this amount. Nothing leaves your account until the work passes.
            </p>
            <p className="mt-3 max-w-[58ch] text-[13px] text-muted">
              The hold lasts 29 days and Handovr renews it once, so the work has about 54 days. If the work never fully
              passes, you agree a split or the hold is cancelled.
            </p>

            <div className="mt-8">
              <FundButton milestoneId={milestone.id} />
            </div>
            <p className="mt-3 text-[13px] text-muted">You approve the hold on PayPal&apos;s own page, then come back here.</p>
          </section>

          <aside>
            <h2 className="font-display text-lg font-medium">What releases the money</h2>
            <ul className="mt-5 space-y-2 text-sm">
              {milestone.version.criteria.map((check) => (
                <li key={check.key} className="flex justify-between gap-6">
                  <span>{check.description}</span>
                  <span className="font-display font-medium">{formatMoney(check.shareCents)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-[13px] text-muted">
              Signed by you and {contract.freelancer.name}.{' '}
              <Link href={`${projectHref}/criteria`} className="font-semibold text-paypal">
                View the checks
              </Link>
            </p>
          </aside>
        </div>
      </main>
    </>
  );
}
