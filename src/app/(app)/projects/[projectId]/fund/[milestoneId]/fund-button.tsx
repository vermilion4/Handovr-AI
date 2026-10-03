'use client';

import { useState, useTransition } from 'react';
import { fundAction } from './actions';

export function FundButton({ milestoneId }: Readonly<{ milestoneId: string }>) {
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError('');
          startTransition(async () => {
            const result = await fundAction(milestoneId);
            if (result?.error) setError(result.error);
          });
        }}
        className="flex h-12 w-full items-center justify-center rounded-full bg-hold text-base font-semibold text-ink hover:bg-[#f2b400] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paypal disabled:opacity-60"
      >
        {pending ? 'Opening PayPal' : 'Fund with PayPal'}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-fail">
          {error}
        </p>
      )}
    </>
  );
}
