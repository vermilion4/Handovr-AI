import { isFinal, type MilestoneState } from './milestone-state';

export interface TimelineMilestone {
  id: string;
  position: number;
  title: string;
  state: MilestoneState;
  fundedAt: Date | null;
  endedAt: Date | null;
}

export interface TimelineTask {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  percentDone: number;
  tone: 'done' | 'active' | 'waiting' | 'stopped';
  estimated: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ESTIMATE_DAYS = 7;

const PROGRESS: Record<MilestoneState, number> = {
  drafting: 0,
  signed: 0,
  funded: 20,
  revision: 40,
  verifying: 60,
  client_review: 75,
  settlement_proposed: 90,
  releasing: 95,
  funding_problem: 20,
  released: 100,
  cancelled: 0,
  lapsed: 0,
};

const dayOf = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);

/** Milestones as timeline bars: real dates where they exist, a week per milestone where they do not. */
export function timelineTasks(
  milestones: TimelineMilestone[],
  projectStart: Date,
  now: Date,
): { tasks: TimelineTask[]; dependencies: Array<{ id: string; fromTask: string; toTask: string }> } {
  const ordered = [...milestones].sort((a, b) => a.position - b.position);
  let cursor = dayOf(projectStart);
  const tasks = ordered.map((milestone): TimelineTask => {
    const start = milestone.fundedAt ? dayOf(milestone.fundedAt) : cursor;
    const finished = isFinal(milestone.state) && milestone.endedAt !== null;
    const end = finished
      ? Math.max(dayOf(milestone.endedAt!), start + DAY_MS)
      : Math.max(start + ESTIMATE_DAYS * DAY_MS, milestone.fundedAt ? dayOf(now) + DAY_MS : 0);
    cursor = end;
    const tone =
      milestone.state === 'released'
        ? 'done'
        : milestone.state === 'cancelled' || milestone.state === 'lapsed'
          ? 'stopped'
          : milestone.fundedAt
            ? 'active'
            : 'waiting';
    return { id: milestone.id, name: milestone.title, startDate: iso(start), endDate: iso(end), percentDone: PROGRESS[milestone.state], tone, estimated: !finished };
  });
  const dependencies = tasks.slice(1).map((task, index) => ({ id: `${tasks[index].id}-${task.id}`, fromTask: tasks[index].id, toTask: task.id }));
  return { tasks, dependencies };
}
