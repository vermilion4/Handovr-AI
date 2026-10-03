import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/auth/current-user';
import { AutoRefresh } from '@/components/auto-refresh';
import { ButtonLink } from '@/components/button';
import { Icon } from '@/components/icon';
import { TopNav } from '@/components/top-nav';
import { db } from '@/db/client';
import { getMilestoneView } from '@/db/queries/milestone-view';
import { isUuid } from '@/domain/ids';
import { MAX_ATTEMPTS, type MilestoneState } from '@/domain/milestone-state';
import { formatMoney } from '@/domain/money';
import { checkDisplay, type AiVerdict, type ClientDecision } from '@/domain/verification';
import { CheckList, type CheckItem } from './check-list';
import { displayLook } from './check-look';
import { ReviewForm } from './review-form';
import { SubmitForm } from './submit-form';

const CHIP: Record<MilestoneState, { label: string; tone: string }> = {
  drafting: { label: 'Agreeing checks', tone: 'bg-tint text-ink' },
  signed: { label: 'Ready to fund', tone: 'bg-tint text-ink' },
  funded: { label: 'Waiting for work', tone: 'bg-hold/30 text-ink' },
  verifying: { label: 'Testing', tone: 'bg-tint text-paypal' },
  client_review: { label: 'In review', tone: 'bg-tint text-ink' },
  revision: { label: 'Needs revision', tone: 'bg-fail/10 text-fail' },
  settlement_proposed: { label: 'Split proposed', tone: 'bg-hold/30 text-ink' },
  releasing: { label: 'Paying out', tone: 'bg-tint text-paypal' },
  released: { label: 'Paid', tone: 'bg-paypal text-white' },
  cancelled: { label: 'Cancelled', tone: 'bg-fail/10 text-fail' },
  funding_problem: { label: 'Funding problem', tone: 'bg-fail/10 text-fail' },
  lapsed: { label: 'Hold expired', tone: 'bg-fail/10 text-fail' },
};

const longDate = new Intl.DateTimeFormat('en-CA', { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
const shortDate = new Intl.DateTimeFormat('en-CA', { day: 'numeric', month: 'short' });

export default async function MilestonePage({
  params,
}: Readonly<{ params: Promise<{ projectId: string; milestoneId: string }> }>) {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  const { projectId, milestoneId } = await params;
  const view = isUuid(projectId) && isUuid(milestoneId) ? await getMilestoneView(db, projectId, milestoneId, user.id) : null;
  if (!view) notFound();

  const { milestone, submission } = view;
  const isClient = view.viewerRole === 'client';
  const clientFirst = view.client.name.split(' ')[0];
  const freelancerFirst = view.freelancer.name.split(' ')[0];
  const running = milestone.state === 'verifying';
  const amountText = formatMoney(milestone.amountCents);

  const verdictOf = (criterionId: string, source: 'ai' | 'client') =>
    view.verdicts.find((verdict) => verdict.criterionId === criterionId && verdict.source === source);

  const checks: CheckItem[] = view.criteria.map((check) => {
    const ai = verdictOf(check.id, 'ai');
    const client = verdictOf(check.id, 'client');
    return {
      id: check.id,
      description: check.description,
      testPlan: check.testPlan,
      shareCents: check.shareCents,
      display: checkDisplay({
        kind: check.kind,
        aiVerdict: (ai?.verdict as AiVerdict | undefined) ?? null,
        clientDecision: (client?.verdict as ClientDecision | undefined) ?? null,
        isCurrent: submission?.currentCriterionId === check.id,
        running,
      }),
      aiSummary: ai?.summary ?? '',
      clientSummary: client && client.verdict === 'rejected' ? client.summary : '',
      evidence: ai ? view.evidence.filter((item) => item.verdictId === ai.id) : [],
    };
  });

  const passedCount = checks.filter((check) => check.display === 'passed' || check.display === 'approved').length;
  const failed = checks.filter((check) => check.display === 'failed' || check.display === 'changes_requested');
  const forClient = checks.filter((check) => check.display === 'unclear' || check.display === 'yours');
  const attemptsLeft = MAX_ATTEMPTS - milestone.attemptsUsed;
  const runScreenshots = view.evidence.filter((item) => item.verdictId === null && item.hasImage);

  const headline: Partial<Record<MilestoneState, string>> = {
    funded: isClient ? `Waiting for ${freelancerFirst} to submit the work.` : `${amountText} is held for this milestone.`,
    verifying: `Attempt ${submission?.attempt ?? 1} of ${MAX_ATTEMPTS}. ${passedCount} of ${checks.filter((check) => check.display !== 'yours').length} automatic checks done.`,
    client_review: `${passedCount} checks passed. ${forClient.length === 1 ? 'One is' : `${forClient.length} are`} waiting for ${isClient ? 'you' : clientFirst}.`,
    revision: `${failed.length === 1 ? 'One check' : `${failed.length} checks`} did not pass. ${attemptsLeft === 1 ? 'One attempt' : `${attemptsLeft} attempts`} left.`,
    settlement_proposed: 'All four attempts are used. A split of the payment is proposed next.',
    releasing: `Every check is settled. ${amountText} is on its way.`,
    released: isClient ? `Every check is settled. ${amountText} was released.` : `Every check is settled. ${amountText} was paid to your PayPal account.`,
  };

  const due = milestone.reviewDueAt ? longDate.format(milestone.reviewDueAt) : null;
  const showLedger = milestone.state === 'released';
  const showReplay = Boolean(submission?.replayUrl) && milestone.state !== 'verifying';

  let panel: React.ReactNode;
  if ((milestone.state === 'funded' || milestone.state === 'revision') && !isClient) {
    panel = (
      <>
        <h2 className="font-display text-lg font-medium">{milestone.state === 'revision' ? 'Resubmit the work' : 'Submit the work'}</h2>
        {submission?.status === 'unreachable' && (
          <p role="alert" className="mt-3 rounded-xl bg-fail/10 px-4 py-3 text-sm text-fail">
            {submission.progressNote}
          </p>
        )}
        <div className="mt-4">
          <SubmitForm
            projectId={view.project.id}
            milestoneId={milestone.id}
            previousUrl={submission?.url ?? ''}
            attemptLabel={`This is attempt ${milestone.attemptsUsed + 1} of ${MAX_ATTEMPTS}.`}
          />
        </div>
      </>
    );
  } else if (milestone.state === 'client_review' && isClient) {
    panel = (
      <ReviewForm
        projectId={view.project.id}
        milestoneId={milestone.id}
        items={forClient.map((check) => ({ id: check.id, description: check.description, unclear: check.display === 'unclear', aiSummary: check.aiSummary }))}
        screenshots={runScreenshots.map((shot) => ({ id: shot.id, caption: shot.caption }))}
        amountText={amountText}
        dueText={due ? `If you do nothing, this is approved on ${due} and ${amountText} is released.` : ''}
        freelancerFirst={freelancerFirst}
      />
    );
  } else if (milestone.state === 'verifying') {
    const current = checks.find((check) => check.display === 'testing');
    panel = (
      <>
        <AutoRefresh everyMs={4000} />
        <p className="text-[13px] font-semibold text-paypal">Testing now</p>
        <h2 className="mt-1 font-display text-lg font-medium">{current?.description ?? 'Opening the site'}</h2>
        <p className="mt-3 text-sm text-muted">{submission?.progressNote || 'Starting the browser'}</p>
        <p className="mt-6 text-[13px] text-muted">
          Testing {submission?.url}. This page updates by itself; you can leave and come back.
        </p>
      </>
    );
  } else {
    const lines: Partial<Record<MilestoneState, string>> = {
      funded: `Waiting for ${freelancerFirst} to submit the work.`,
      revision: `Waiting for ${freelancerFirst} to fix the work and resubmit.`,
      client_review: `Waiting for ${clientFirst}'s review.${due ? ` If ${clientFirst} does nothing, it is approved on ${due}.` : ''}`,
      settlement_proposed: 'A split based on the checks that passed comes next, for both of you to accept.',
      releasing: 'PayPal is sending the payment. This usually takes under a minute.',
      signed: 'This milestone has not been funded yet.',
      drafting: 'The checks for this milestone are still being agreed.',
      cancelled: 'This milestone was cancelled. The hold was returned and nothing was paid.',
      lapsed: 'The hold expired before the work was released. Nothing was paid.',
      funding_problem: 'The hold could not be collected. The client needs to fund again.',
    };
    panel =
      milestone.state === 'released' ? (
        <>
          <h2 className="flex items-center gap-2 font-semibold">
            <Icon name="payments" size={20} />
            Paid to {view.freelancer.email}
          </h2>
          <ul className="mt-4 space-y-2 text-sm">
            {view.payments
              .filter((payment) => payment.status === 'completed')
              .map((payment, index) => (
                <li key={index} className="flex gap-4">
                  <span className="w-14 shrink-0 text-muted">{shortDate.format(payment.at)}</span>
                  <span>
                    {{ hold: 'Payment held', renew: 'Hold renewed', capture: 'Payment captured', payout: 'PayPal payout sent', void: 'Hold cancelled' }[payment.type]}{' '}
                    <span className="font-display font-medium">{formatMoney(payment.amountCents)}</span>
                  </span>
                </li>
              ))}
          </ul>
        </>
      ) : (
        <p className="text-sm">{lines[milestone.state] ?? ''}</p>
      );
  }

  return (
    <>
      <TopNav user={user} active="projects" />
      <main className="mx-auto max-w-[1440px] px-4 pb-16 pt-6 md:px-24 md:pt-8">
        <p className="text-[13px] text-muted">
          <Link href={`/projects/${view.project.id}`} className="hover:text-ink">
            {view.project.title}
          </Link>{' '}
          / Milestone {milestone.position}
        </p>
        <h1 className="mt-2 font-display text-2xl font-medium md:text-[28px]">{milestone.title}</h1>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <p className="font-display text-5xl font-medium md:text-6xl">{amountText}</p>
          <span className={`rounded-full px-4 py-1.5 text-xs font-semibold ${CHIP[milestone.state].tone}`}>{CHIP[milestone.state].label}</span>
        </div>
        {headline[milestone.state] && <p className="mt-3 text-muted">{headline[milestone.state]}</p>}

        <div className="mt-6 flex gap-1.5" role="img" aria-label="Each check, sized by its share of the payment">
          {checks.map((check) => (
            <div key={check.id} className="min-w-0" style={{ flexGrow: check.shareCents, flexBasis: 0 }}>
              <div className={`h-6 rounded-lg ${displayLook(check.display, clientFirst, isClient).bar}`} />
              <p className="mt-1.5 truncate text-[11px] text-muted">
                {check.description}, {formatMoney(check.shareCents)}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
          <CheckList checks={checks} clientFirst={clientFirst} viewerIsClient={isClient} />
          <section className="h-fit rounded-2xl bg-white p-6">
            {milestone.state === 'releasing' && <AutoRefresh everyMs={4000} />}
            {panel}
            {(showLedger || showReplay) && (
              <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-semibold text-paypal">
                {showLedger && (
                  <Link href="/ledger" className="inline-flex items-center gap-1.5">
                    <Icon name="receipt_long" size={18} />
                    Open the ledger
                  </Link>
                )}
                {showReplay && submission?.replayUrl && (
                  <a href={submission.replayUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5">
                    <Icon name="play_circle" size={18} />
                    Watch the test replay
                  </a>
                )}
              </div>
            )}
          </section>
        </div>

        <div className="mt-8">
          <ButtonLink href={`/projects/${view.project.id}`} variant="secondary">
            Back to the project
          </ButtonLink>
        </div>
      </main>
    </>
  );
}
