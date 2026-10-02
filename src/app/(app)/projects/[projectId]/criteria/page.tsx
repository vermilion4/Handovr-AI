import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/auth/current-user';
import { TopNav } from '@/components/top-nav';
import { db } from '@/db/client';
import { getContract } from '@/db/queries/contract';
import { contractStatus, draftingActive } from '@/domain/contract';
import { diffCriteria } from '@/domain/criteria';
import { isUuid } from '@/domain/ids';
import { DraftingProgress } from './drafting-progress';
import { ReviewList, type ReviewMilestone } from './review-list';

const longDate = new Intl.DateTimeFormat('en-CA', { day: 'numeric', month: 'long', year: 'numeric' });

export default async function CriteriaPage({ params }: Readonly<{ params: Promise<{ projectId: string }> }>) {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  const { projectId } = await params;
  const contract = isUuid(projectId) ? await getContract(db, projectId, user.id) : null;
  if (!contract) notFound();

  const isClient = contract.viewerRole === 'client';
  const otherFirst = (isClient ? contract.freelancer : contract.client).name.split(' ')[0];
  const drafting = contract.milestones.some((milestone) => milestone.criteriaDraft !== 'ready');

  const review: ReviewMilestone[] = drafting
    ? []
    : contract.milestones.map((milestone) => {
        const version = milestone.version!;
        const status = contractStatus(milestone, user.id);
        return {
          id: milestone.id,
          position: milestone.position,
          title: milestone.title,
          amountCents: milestone.amountCents,
          status,
          versionId: version.id,
          reason: version.reason,
          criteria: version.criteria,
          diff: status === 'changes_suggested' && version.previous ? diffCriteria(version.previous, version.criteria) : null,
        };
      });

  return (
    <>
      <TopNav user={user} active="projects" />
      <main className="mx-auto max-w-[1440px] px-4 pt-6 md:px-24 md:pt-8">
        <p className="text-[13px] text-muted">
          <Link href="/projects" className="hover:text-ink">
            Projects
          </Link>{' '}
          / {contract.project.title}
        </p>
        <h1 className="mt-2 font-display text-2xl font-medium md:text-[28px]">
          {drafting ? 'Drafting the criteria' : 'Review and sign the criteria'}
        </h1>

        {drafting ? (
          <DraftingProgress
            projectId={contract.project.id}
            milestones={contract.milestones}
            active={draftingActive(contract.milestones, new Date())}
          />
        ) : (
          <>
            <p className="mt-2 max-w-[75ch] text-muted">
              {isClient
                ? `Handovr drafted these from your briefs, and ${otherFirst} has the same lists.`
                : `Handovr drafted these from ${otherFirst}'s briefs, and ${otherFirst} has the same lists.`}{' '}
              Sign the ones you are happy with and change the rest.
            </p>
            <ReviewList
              projectId={contract.project.id}
              milestones={review}
              viewer={{ email: user.email, role: contract.viewerRole }}
              otherFirst={otherFirst}
              clientFirst={contract.client.name.split(' ')[0]}
              today={longDate.format(new Date())}
            />
          </>
        )}
      </main>
    </>
  );
}
