'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/button';
import { restartMilestoneAction } from './actions';

export function RestartButton({ projectId, milestoneId, freelancerFirst }: Readonly<{ projectId: string; milestoneId: string; freelancerFirst: string }>) {
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  function restart() {
    setError('');
    startTransition(async () => {
      const result = await restartMilestoneAction(projectId, milestoneId);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="mt-5 border-t border-line pt-5">
      <p className="text-sm">Start this milestone again with the same checks. You and {freelancerFirst} sign the checks again before you fund it.</p>
      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-fail/10 px-4 py-3 text-sm text-fail">
          {error}
        </p>
      )}
      <Button type="button" onClick={restart} disabled={pending} className="mt-4 w-full disabled:opacity-50">
        {pending ? 'Starting' : 'Start again'}
      </Button>
    </div>
  );
}
