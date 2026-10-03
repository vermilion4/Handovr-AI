import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/auth/current-user';
import { ButtonLink } from '@/components/button';
import { Icon } from '@/components/icon';
import { AddressResultDialog } from '@/components/result-dialog';
import { TopNav } from '@/components/top-nav';
import { db } from '@/db/client';
import { getContract, type ContractMilestone } from '@/db/queries/contract';
import { contractStatus } from '@/domain/contract';
import { holdTotalCents } from '@/domain/hold';
import { isUuid } from '@/domain/ids';
import { isFinal, type MilestoneState } from '@/domain/milestone-state';
import { formatMoney } from '@/domain/money';
import { milestoneStatus, type ProjectSummary } from '@/domain/project-summary';

const HELD: ReadonlySet<MilestoneState> = new Set([
  'funded',
  'verifying',
  'client_review',
  'revision',
  'settlement_proposed',
  'releasing',
  'funding_problem',
]);
const UNFUNDED: ReadonlySet<MilestoneState> = new Set(['drafting', 'signed']);
const RELEASED: ReadonlySet<MilestoneState> = new Set(['released']);

const toneClass: Record<ProjectSummary['status']['tone'], string> = {
  attention: 'font-semibold text-ink',
  progress: 'text-paypal',
  neutral: 'text-muted',
  done: 'text-pass',
};

function actionHref(projectId: string, milestone: ContractMilestone, isClient: boolean): string | null {
  if (milestone.state === 'drafting') return `/projects/${projectId}/criteria`;
  if (isClient && (milestone.state === 'signed' || milestone.state === 'funding_problem')) {
    return `/projects/${projectId}/fund/${milestone.id}`;
  }
  return null;
}

export default async function ProjectPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ projectId: string }>; searchParams: Promise<{ funded?: string }> }>) {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  const { projectId } = await params;
  const { funded } = await searchParams;
  const contract = isUuid(projectId) ? await getContract(db, projectId, user.id) : null;
  if (!contract) notFound();

  const isClient = contract.viewerRole === 'client';
  const other = isClient ? contract.freelancer : contract.client;
  const otherFirst = other.name.split(' ')[0];

  const rows = contract.milestones.map((milestone) => {
    // Milestones are funded in order, so a signed one waits for the ones before it.
    const before = contract.milestones.find((other) => other.position < milestone.position && !isFinal(other.state));
    if (before && (milestone.state === 'signed' || milestone.state === 'funding_problem')) {
      const status = { icon: 'schedule', text: `Starts when ${before.title} is finished`, tone: 'neutral' as const, action: 'Open' };
      return { milestone, href: null, status };
    }

    const status = milestoneStatus(
      {
        position: milestone.position,
        title: milestone.title,
        amountCents: milestone.amountCents,
        state: milestone.state,
        criteriaDraft: milestone.criteriaDraft,
        contract: contractStatus(milestone, user.id),
      },
      contract.viewerRole,
      otherFirst,
    );
    return { milestone, href: actionHref(contract.project.id, milestone, isClient), status };
  });

  const sum = (states: ReadonlySet<MilestoneState>) =>
    contract.milestones.filter((m) => states.has(m.state)).reduce((total, m) => total + m.amountCents, 0);
  const next = rows.find((row) => row.href);
  const justFunded = contract.milestones.find((m) => m.id === funded && HELD.has(m.state));
  const count = contract.milestones.length;

  return (
    <>
      <TopNav user={user} active="projects" />
      {justFunded && (
        <AddressResultDialog
          feedback={{
            tone: 'success',
            title: 'Hold placed',
            message: `PayPal is holding ${formatMoney(isClient ? holdTotalCents(justFunded.amountCents) : justFunded.amountCents)} for ${justFunded.title}. ${isClient ? `${otherFirst} can start work.` : 'You can start work.'} Nothing leaves your account until the work passes.`,
          }}
          next={{ label: 'Back to projects', href: '/projects' }}
          closeLabel="View project"
        />
      )}
      <main className="mx-auto max-w-[1440px] px-4 pb-16 pt-6 md:px-24 md:pt-8">
        <Link href="/projects" className="text-[13px] text-muted hover:text-ink">
          Projects
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-medium md:text-[28px]">{contract.project.title}</h1>
            <p className="mt-2 text-muted">
              {isClient ? 'With' : 'For'} {other.name}, {count === 1 ? '1 milestone' : `${count} milestones`}
            </p>
          </div>
          {next && (
            <ButtonLink href={next.href!} className="max-md:w-full">
              {next.status.action}
            </ButtonLink>
          )}
        </div>


        <dl className="mt-8 grid gap-6 sm:grid-cols-3 sm:gap-12 md:max-w-[760px]">
          <div>
            <dd className="font-display text-[32px] font-medium text-paypal">{formatMoney(sum(RELEASED))}</dd>
            <dt className="text-[13px] text-muted">{isClient ? 'Released' : 'Paid to you'}</dt>
          </div>
          <div>
            <dd className="font-display text-[32px] font-medium">{formatMoney(sum(HELD))}</dd>
            <dt className="flex items-center gap-2 text-[13px] text-muted">
              <span className="size-2.5 rounded-full bg-hold" />
              {isClient ? 'Held' : 'Held for you'}
            </dt>
          </div>
          <div>
            <dd className="font-display text-[32px] font-medium text-muted">{formatMoney(sum(UNFUNDED))}</dd>
            <dt className="text-[13px] text-muted">Not yet funded</dt>
          </div>
        </dl>

        <ol className="mt-8 divide-y divide-line rounded-2xl bg-white px-5 md:px-8">
          {rows.map(({ milestone, status, href }) => (
            <li key={milestone.id} className="grid gap-x-6 gap-y-2 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_220px] md:items-center">
              <div>
                <h2 className="font-semibold">
                  <span className="mr-2 font-display font-medium text-paypal">{milestone.position}</span>
                  {milestone.title}
                </h2>
                <p className="mt-0.5 font-display text-sm font-medium text-muted">{formatMoney(milestone.amountCents)}</p>
              </div>
              <p className={`flex items-center gap-1.5 text-[13px] ${toneClass[status.tone]}`}>
                <Icon name={status.icon} size={18} />
                {status.text}
              </p>
              <div className="flex items-center gap-5 text-sm font-semibold text-paypal md:justify-end">
                {milestone.state !== 'drafting' && (
                  <Link href={`/projects/${contract.project.id}/criteria`}>View checks</Link>
                )}
                {href && <Link href={href}>{status.action}</Link>}
              </div>
            </li>
          ))}
        </ol>
      </main>
    </>
  );
}
