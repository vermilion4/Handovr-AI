'use client';

import { BryntumGantt } from '@bryntum/gantt-react';
import '@bryntum/gantt/fontawesome/css/fontawesome.css';
import '@bryntum/gantt/fontawesome/css/solid.css';
import '@bryntum/gantt/gantt.css';
import '@bryntum/gantt/stockholm-light.css';
import type { TimelineTask } from '@/domain/timeline';

const COLOUR: Record<TimelineTask['tone'], string> = { done: 'green', active: 'blue', waiting: 'gray', stopped: 'red' };

export default function TimelineGantt({
  tasks,
  dependencies,
}: Readonly<{ tasks: TimelineTask[]; dependencies: Array<{ id: string; fromTask: string; toTask: string }> }>) {
  return (
    <BryntumGantt
      height={Math.max(180, 64 + tasks.length * 48)}
      readOnly
      viewPreset="weekAndDayLetter"
      columns={[{ type: 'name', text: 'Milestone', width: 220 }]}
      project={{
        tasks: tasks.map((task) => ({
          id: task.id,
          name: task.estimated ? `${task.name} (estimated)` : task.name,
          startDate: task.startDate,
          endDate: task.endDate,
          percentDone: task.percentDone,
          manuallyScheduled: true,
          eventColor: COLOUR[task.tone],
        })),
        dependencies,
      }}
      taskMenuFeature={false}
    />
  );
}
