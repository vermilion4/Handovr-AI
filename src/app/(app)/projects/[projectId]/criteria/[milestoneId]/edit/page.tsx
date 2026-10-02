import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/auth/current-user';
import { TopNav } from '@/components/top-nav';
import { db } from '@/db/client';
import { getContract } from '@/db/queries/contract';
import { isUuid } from '@/domain/ids';
import { EditForm } from './edit-form';

export default async function EditCriteriaPage({
  params,
}: Readonly<{ params: Promise<{ projectId: string; milestoneId: string }> }>) {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  const { projectId, milestoneId } = await params;
  const contract = isUuid(projectId) ? await getContract(db, projectId, user.id) : null;
  const milestone = contract?.milestones.find((candidate) => candidate.id === milestoneId);
  if (!contract || !milestone) notFound();

  const criteriaHref = `/projects/${contract.project.id}/criteria`;
  if (milestone.state !== 'drafting' || !milestone.version) redirect(criteriaHref);

  const isClient = contract.viewerRole === 'client';
  const otherFirst = (isClient ? contract.freelancer : contract.client).name.split(' ')[0];

  return (
    <>
      <TopNav user={user} active="projects" />
      <main className="mx-auto max-w-[1440px] px-4 pt-6 md:px-24 md:pt-8">
        <p className="text-[13px] text-muted">
          <Link href="/projects" className="hover:text-ink">
            Projects
          </Link>{' '}
          /{' '}
          <Link href={criteriaHref} className="hover:text-ink">
            {contract.project.title}
          </Link>{' '}
          / Criteria
        </p>
        <h1 className="mt-2 font-display text-2xl font-medium md:text-[28px]">Edit the {milestone.title} checks</h1>
        <p className="mt-2 max-w-[75ch] text-muted">
          Change a check yourself or tell Handovr what you want. {otherFirst} sees your changes marked on the list.
        </p>

        <EditForm
          projectId={contract.project.id}
          milestoneId={milestone.id}
          baseVersionId={milestone.version.id}
          amountCents={milestone.amountCents}
          original={milestone.version.criteria}
          otherFirst={otherFirst}
          clientFirst={contract.client.name.split(' ')[0]}
          viewerIsClient={isClient}
        />
      </main>
    </>
  );
}
