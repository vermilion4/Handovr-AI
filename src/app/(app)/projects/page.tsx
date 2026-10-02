import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/auth/current-user';
import { ButtonLink } from '@/components/button';
import { Icon } from '@/components/icon';
import { MoneyBar } from '@/components/money-bar';
import { TopNav } from '@/components/top-nav';
import { db } from '@/db/client';
import { listProjectsForUser } from '@/db/queries/projects';
import { formatMoney } from '@/domain/money';
import { summariseProject, type ProjectSummary } from '@/domain/project-summary';

const toneClass: Record<ProjectSummary['status']['tone'], string> = {
  attention: 'font-semibold text-ink',
  progress: 'text-paypal',
  neutral: 'text-muted',
  done: 'text-pass',
};

interface Row {
  id: string;
  title: string;
  withLabel: string;
  summary: ProjectSummary;
  heldCents: number;
}

function ProjectRows({ rows }: { rows: Row[] }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-white max-md:space-y-3 max-md:divide-y-0 max-md:bg-transparent">
      {rows.map(({ id, title, withLabel, summary }) => (
        <li
          key={id}
          className="grid gap-3 px-4 py-4 max-md:rounded-[14px] max-md:bg-white md:grid-cols-[1.3fr_1.4fr_1.3fr_auto] md:items-center md:gap-8 md:px-8 md:py-6"
        >
          <div>
            <h3 className="font-semibold">{title}</h3>
            <p className="text-[13px] text-muted">{withLabel}</p>
          </div>
          <div>
            <p className="text-sm max-md:hidden">{summary.milestoneLabel}</p>
            <p className={`flex items-center gap-1.5 text-[13px] ${toneClass[summary.status.tone]}`}>
              <Icon name={summary.status.icon} size={18} />
              {summary.status.text}
            </p>
          </div>
          <div>
            <MoneyBar segments={summary.segments} />
            <p className="mt-2 text-xs text-muted">{summary.caption}</p>
          </div>
          <Link href={`/projects/${id}`} className="text-sm font-semibold text-paypal md:w-28">
            {summary.actionLabel}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function ProjectsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  const projects = await listProjectsForUser(db, user.id);
  const rows: Row[] = projects.map((project) => {
    const role = project.client.id === user.id ? 'client' : 'freelancer';
    const counterpart = role === 'client' ? project.freelancer : project.client;
    const summary = summariseProject({
      role,
      counterpartName: counterpart.name,
      finishedAt: project.finishedAt,
      milestones: project.milestones,
    });
    return {
      id: project.id,
      title: project.title,
      withLabel: `${role === 'client' ? 'With' : 'For'} ${counterpart.name}`,
      summary,
      heldCents: summary.segments.filter((s) => s.kind === 'held').reduce((t, s) => t + s.amountCents, 0),
    };
  });

  const active = rows.filter((r) => !r.summary.finished);
  const finished = rows.filter((r) => r.summary.finished);
  const heldRows = active.filter((r) => r.heldCents > 0);
  const heldTotal = heldRows.reduce((t, r) => t + r.heldCents, 0);
  const needing = active.filter((r) => r.summary.needsViewer).length;
  const plural = (n: number, one: string, many: string) => `${n === 1 ? 'One' : n} ${n === 1 ? one : many}`;

  const heldForYou = user.role === 'client' ? '' : ' for you';
  const heldProjectLabel = heldRows.length === 1 ? 'one project' : `${heldRows.length} projects`;

  let overview = 'Nothing is held right now.';
  if (heldTotal > 0) {
    const heldMessage = `${formatMoney(heldTotal)} is held${heldForYou} across ${heldProjectLabel}.`;
    const needsMessage = needing > 0 ? `${plural(needing, 'needs', 'need')} you.` : 'Nothing needs you right now.';
    overview = `${heldMessage} ${needsMessage}`;
  } else if (needing > 0) {
    overview = `${plural(needing, 'project needs', 'projects need')} you.`;
  }

  return (
    <>
      <TopNav user={user} active="projects" />
      <main className="mx-auto max-w-360 px-4 pb-16 pt-6 md:px-24 md:pt-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-medium md:text-[28px]">Projects</h1>
            {rows.length > 0 && <p className="mt-2 text-sm text-muted md:text-base">{overview}</p>}
          </div>
          {user.role === 'client' && (
            <ButtonLink href="/projects/new" className="max-md:w-full">
              New project
            </ButtonLink>
          )}
        </div>

        {rows.length === 0 && (
          <div className="mt-8 rounded-2xl bg-white px-8 py-12">
            <h2 className="font-display text-xl font-medium">No projects yet</h2>
            <p className="mt-2 max-w-prose text-muted">
              {user.role === 'client'
                ? 'Start a project, describe each milestone, and Handovr drafts the checks that will release each payment.'
                : 'When a client starts a project with your PayPal email, it appears here for you to review and sign.'}
            </p>
          </div>
        )}

        {active.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-[13px] font-semibold text-muted">Active</h2>
            <ProjectRows rows={active} />
          </section>
        )}

        {finished.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-[13px] font-semibold text-muted">Finished</h2>
            <ProjectRows rows={finished} />
          </section>
        )}
      </main>
    </>
  );
}
