'use client';

import dynamic from 'next/dynamic';
import { Component, type ReactNode } from 'react';
import type { TimelineTask } from '@/domain/timeline';
import { SimpleTimeline } from './simple-timeline';

type Props = Readonly<{ tasks: TimelineTask[]; dependencies: Array<{ id: string; fromTask: string; toTask: string }> }>;

const Gantt = dynamic(() => import('./timeline-gantt'), { ssr: false });

class Fallback extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** The Bryntum Gantt, with plain bars when it cannot load or is switched off. */
export function Timeline(props: Props) {
  if (process.env.NEXT_PUBLIC_TIMELINE === 'simple') return <SimpleTimeline {...props} />;
  return (
    <Fallback fallback={<SimpleTimeline {...props} />}>
      <Gantt {...props} />
    </Fallback>
  );
}
