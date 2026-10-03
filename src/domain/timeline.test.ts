import { describe, expect, it } from 'vitest';
import { timelineTasks, type TimelineMilestone } from './timeline';

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);
const milestone = (position: number, state: TimelineMilestone['state'], fundedAt: string | null, endedAt: string | null): TimelineMilestone => ({
  id: `m${position}`,
  position,
  title: `Milestone ${position}`,
  state,
  fundedAt: fundedAt ? day(fundedAt) : null,
  endedAt: endedAt ? day(endedAt) : null,
});

describe('timelineTasks', () => {
  it('draws finished milestones as they happened and estimates the rest a week at a time', () => {
    const { tasks, dependencies } = timelineTasks(
      [milestone(2, 'verifying', '2026-10-10', null), milestone(1, 'released', '2026-10-03', '2026-10-09'), milestone(3, 'signed', null, null)],
      day('2026-10-01'),
      day('2026-10-20'),
    );
    expect(tasks.map((task) => [task.id, task.startDate, task.endDate, task.percentDone, task.tone, task.estimated])).toEqual([
      ['m1', '2026-10-03', '2026-10-09', 100, 'done', false],
      ['m2', '2026-10-10', '2026-10-21', 60, 'active', true],
      ['m3', '2026-10-21', '2026-10-28', 0, 'waiting', true],
    ]);
    expect(dependencies).toEqual([
      { id: 'm1-m2', fromTask: 'm1', toTask: 'm2' },
      { id: 'm2-m3', fromTask: 'm2', toTask: 'm3' },
    ]);
  });

  it('gives a milestone that ended the day it started one day, and marks stopped ones', () => {
    const { tasks } = timelineTasks([milestone(1, 'cancelled', '2026-10-02', '2026-10-02'), milestone(2, 'drafting', null, null)], day('2026-10-01'), day('2026-10-05'));
    expect(tasks.map((task) => [task.startDate, task.endDate, task.tone])).toEqual([
      ['2026-10-02', '2026-10-03', 'stopped'],
      ['2026-10-03', '2026-10-10', 'waiting'],
    ]);
  });

  it('starts an unfunded first milestone at the project start', () => {
    const { tasks } = timelineTasks([milestone(1, 'drafting', null, null)], day('2026-10-01'), day('2026-10-05'));
    expect([tasks[0].startDate, tasks[0].endDate]).toEqual(['2026-10-01', '2026-10-08']);
  });

  it('has no tasks for no milestones', () => {
    expect(timelineTasks([], day('2026-10-01'), day('2026-10-05'))).toEqual({ tasks: [], dependencies: [] });
  });
});
