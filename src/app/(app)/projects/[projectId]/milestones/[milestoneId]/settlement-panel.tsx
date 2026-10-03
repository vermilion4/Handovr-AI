'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/button';
import { ResultDialog } from '@/components/result-dialog';
import type { Feedback } from '@/domain/feedback';
import { respondToSettlementAction } from './actions';

export function SettlementPanel({
  projectId,
  milestoneId,
  freelancerText,
  clientText,
  freelancerName,
  explanation,
  amountText,
  mine,
  otherFirst,
  otherAccepted,
  dueText,
}: Readonly<{
  projectId: string;
  milestoneId: string;
  freelancerText: string;
  clientText: string;
  freelancerName: string;
  explanation: string;
  amountText: string;
  /** The viewer's own answer so far. */
  mine: 'accepted' | 'declined' | null;
  otherFirst: string;
  otherAccepted: boolean;
  dueText: string;
}>) {
  const router = useRouter();
  const [confirmingDecline, setConfirmingDecline] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pending, startTransition] = useTransition();
  const freelancerFirst = freelancerName.split(' ')[0];

  function answer(response: 'accepted' | 'declined') {
    setError('');
    startTransition(async () => {
      const result = await respondToSettlementAction(projectId, milestoneId, response);
      if (result.error) {
        setError(result.error);
        return;
      }
      setFeedback(
        result.outcome === 'accepted'
          ? { tone: 'success', title: 'Split accepted', message: `You both accepted. ${freelancerText} is on its way to ${freelancerFirst} and ${clientText} stays with the client.` }
          : result.outcome === 'declined'
            ? { tone: 'warning', title: 'Split declined', message: `The milestone is cancelled. All ${amountText} goes back to the client and nothing is paid.` }
            : { tone: 'success', title: 'Split accepted', message: `Waiting for ${otherFirst} to answer. If ${otherFirst} declines, all ${amountText} goes back to the client.` },
      );
    });
  }

  const status = mine
    ? `You accepted. Waiting for ${otherFirst}.`
    : otherAccepted
      ? `${otherFirst} has accepted. If either of you declines, all ${amountText} returns to the client.`
      : `If either of you declines, all ${amountText} returns to the client.`;

  return (
    <div>
      <h2 className="font-display text-lg font-medium">Proposed split</h2>
      <dl className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <dd className="font-display text-[32px] font-medium text-paypal">{freelancerText}</dd>
          <dt className="text-[13px] text-muted">to {freelancerName}</dt>
        </div>
        <div>
          <dd className="font-display text-[32px] font-medium">{clientText}</dd>
          <dt className="text-[13px] text-muted">back to the client</dt>
        </div>
      </dl>
      <p className="mt-4 text-sm leading-relaxed">{explanation}</p>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-fail/10 px-4 py-3 text-sm text-fail">
          {error}
        </p>
      )}

      {!mine && !confirmingDecline && (
        <div className="mt-5 flex flex-wrap gap-3">
          <Button type="button" onClick={() => answer('accepted')} disabled={pending} className="flex-1 disabled:opacity-50">
            {pending ? 'Sending' : 'Accept split'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setConfirmingDecline(true)} disabled={pending} className="flex-1">
            Decline
          </Button>
        </div>
      )}
      {!mine && confirmingDecline && (
        <div className="mt-5 rounded-xl border border-line p-4">
          <p className="text-sm font-semibold">Decline the split?</p>
          <p className="mt-1 text-[13px] text-muted">
            The milestone is cancelled, all {amountText} goes back to the client and nothing is paid. This cannot be undone.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => answer('declined')}
              disabled={pending}
              className="inline-flex h-12 flex-1 items-center justify-center rounded-full bg-fail px-7 text-base font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fail disabled:opacity-50"
            >
              {pending ? 'Sending' : 'Decline and cancel'}
            </button>
            <Button type="button" variant="secondary" onClick={() => setConfirmingDecline(false)} disabled={pending} className="flex-1">
              Keep the split
            </Button>
          </div>
        </div>
      )}
      <p className="mt-3 text-[13px] text-muted">{status}</p>
      <p className="mt-1 text-[13px] text-muted">{dueText}</p>

      <ResultDialog
        feedback={feedback}
        open={feedback !== null}
        next={{ label: 'Back to projects', href: '/projects' }}
        closeLabel="Stay here"
        onClose={() => {
          setFeedback(null);
          router.refresh();
        }}
      />
    </div>
  );
}
