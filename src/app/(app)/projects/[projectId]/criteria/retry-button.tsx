'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/button';
import { retryDraftingAction } from './actions';

export function RetryButton({ projectId, label }: Readonly<{ projectId: string; label: string }>) {
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <Button
        type="button"
        disabled={pending}
        className="disabled:opacity-60"
        onClick={() =>
          startTransition(async () => {
            const result = await retryDraftingAction(projectId);
            setError(result.error ?? '');
          })
        }
      >
        {pending ? 'Starting' : label}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-fail">
          {error}
        </p>
      )}
    </div>
  );
}
