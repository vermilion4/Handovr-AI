import { ButtonLink } from '@/components/button';
import { Icon } from '@/components/icon';
import type { ContractMilestone } from '@/db/queries/contract';
import { AutoRefresh } from '@/components/auto-refresh';
import { RetryButton } from './retry-button';

function rowStatus(milestone: ContractMilestone, active: boolean) {
  if (milestone.criteriaDraft === 'ready') {
    const count = milestone.version?.criteria.length ?? 0;
    return { icon: 'check_circle', tone: 'text-pass', text: `${count} checks drafted`, spin: false };
  }
  if (milestone.criteriaDraft === 'failed') {
    return { icon: 'error', tone: 'text-fail', text: 'Could not be drafted', spin: false };
  }
  return active
    ? { icon: 'progress_activity', tone: 'text-paypal', text: 'Writing checks', spin: true }
    : { icon: 'schedule', tone: 'text-muted', text: 'Waiting', spin: false };
}

export function DraftingProgress({
  projectId,
  milestones,
  active,
}: Readonly<{ projectId: string; milestones: ContractMilestone[]; active: boolean }>) {
  const ready = milestones.filter((milestone) => milestone.criteriaDraft === 'ready').length;
  const anyFailed = milestones.some((milestone) => milestone.criteriaDraft === 'failed');

  return (
    <section className="mx-auto mt-6 max-w-[760px] rounded-2xl bg-white p-6 md:p-8">
      {active && <AutoRefresh />}

      <div className="flex items-center gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-tint text-paypal">
          <Icon name="smart_toy" size={26} />
        </span>
        <div>
          <h2 className="font-display text-xl font-medium">
            {active ? 'Handovr is turning the briefs into checks' : 'The checks are not finished yet'}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {active
              ? 'Each check gets a test you can read. This usually takes under a minute.'
              : 'Drafting stopped before every milestone had its list.'}
          </p>
        </div>
      </div>

      <div
        className="mt-6 h-1.5 overflow-hidden rounded-full bg-tint"
        role="progressbar"
        aria-label="Milestones drafted"
        aria-valuemin={0}
        aria-valuemax={milestones.length}
        aria-valuenow={ready}
      >
        <div className="h-full rounded-full bg-paypal transition-[width]" style={{ width: `${(ready / milestones.length) * 100}%` }} />
      </div>

      <ul className="mt-2 divide-y divide-line" aria-live="polite">
        {milestones.map((milestone) => {
          const status = rowStatus(milestone, active);
          return (
            <li key={milestone.id} className="flex items-center gap-3 py-4">
              <Icon name={status.icon} size={22} className={`${status.tone} ${status.spin ? 'motion-safe:animate-spin' : ''}`} />
              <span className="flex-1 font-semibold">{milestone.title}</span>
              <span className={`text-[13px] ${status.tone}`}>{status.text}</span>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 max-w-[52ch] text-sm text-muted">
        {active
          ? 'You can leave this page. Handovr keeps working, and the lists will be here when you come back.'
          : 'Nothing has been lost. Start the drafting again and the finished lists are kept.'}
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        {!active && <RetryButton projectId={projectId} label={anyFailed ? 'Try again' : 'Draft the criteria now'} />}
        <ButtonLink href="/projects" variant="secondary">
          Back to projects
        </ButtonLink>
      </div>
    </section>
  );
}
