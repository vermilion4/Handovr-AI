import type { TimelineTask } from '@/domain/timeline';

const BAR: Record<TimelineTask['tone'], string> = { done: 'bg-paypal', active: 'bg-hold', waiting: 'bg-line', stopped: 'bg-fail/40' };

/** Plain timeline bars, used while the Gantt loads or when it cannot run. */
export function SimpleTimeline({ tasks }: Readonly<{ tasks: TimelineTask[]; dependencies?: unknown }>) {
  if (tasks.length === 0) return null;
  const time = (date: string) => new Date(`${date}T00:00:00Z`).getTime();
  const first = Math.min(...tasks.map((task) => time(task.startDate)));
  const span = Math.max(...tasks.map((task) => time(task.endDate))) - first || 1;

  return (
    <ol className="space-y-3">
      {tasks.map((task) => (
        <li key={task.id} className="grid gap-x-4 gap-y-1 md:grid-cols-[200px_minmax(0,1fr)] md:items-center">
          <p className="truncate text-sm">
            {task.name}
            {task.estimated && <span className="text-muted"> (estimated)</span>}
          </p>
          <div className="relative h-4 rounded-full bg-mist">
            <div
              className={`absolute inset-y-0 rounded-full ${BAR[task.tone]}`}
              style={{ left: `${((time(task.startDate) - first) / span) * 100}%`, width: `${Math.max(2, ((time(task.endDate) - time(task.startDate)) / span) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}
