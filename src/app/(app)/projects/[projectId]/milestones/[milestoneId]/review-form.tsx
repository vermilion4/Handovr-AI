'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/button';
import { inputClass, labelClass } from '@/components/field';
import { ResultDialog } from '@/components/result-dialog';
import type { ClientDecision } from '@/domain/verification';
import type { Feedback } from '@/domain/feedback';
import { submitReviewAction } from './actions';

export function ReviewForm({
  projectId,
  milestoneId,
  items,
  screenshots,
  amountText,
  dueText,
  freelancerFirst,
}: Readonly<{
  projectId: string;
  milestoneId: string;
  items: Array<{ id: string; description: string; unclear: boolean; aiSummary: string }>;
  screenshots: Array<{ id: string; caption: string }>;
  amountText: string;
  dueText: string;
  freelancerFirst: string;
}>) {
  const router = useRouter();
  const [decisions, setDecisions] = useState<Record<string, ClientDecision>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pending, startTransition] = useTransition();

  const decided = items.every((item) => decisions[item.id]);
  const rejecting = items.some((item) => decisions[item.id] === 'rejected');

  function send() {
    setError('');
    startTransition(async () => {
      const result = await submitReviewAction(projectId, milestoneId, decisions, reason);
      if (result.error) {
        setError(result.error);
        return;
      }
      setFeedback(
        result.released
          ? { tone: 'success', title: 'Payment released', message: `${amountText} is on its way to ${freelancerFirst}. It usually arrives within a minute.` }
          : { tone: 'success', title: 'Sent back for changes', message: `${freelancerFirst} sees your reasons and can resubmit. This used one of the four attempts.` },
      );
    });
  }

  return (
    <div>
      <h2 className="font-display text-lg font-medium">Your review</h2>
      <p className="mt-1 text-[13px] text-muted">These checks are yours to decide. The tester passed everything else.</p>

      {screenshots.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {screenshots.map((shot) => (
            <figure key={shot.id}>
              <Image src={`/api/evidence/${shot.id}`} alt={shot.caption} width={640} height={400} unoptimized className="h-auto w-full rounded-lg border border-line" />
              <figcaption className="mt-1 text-xs text-muted">{shot.caption}</figcaption>
            </figure>
          ))}
        </div>
      )}

      <ul className="mt-5 space-y-4">
        {items.map((item) => (
          <li key={item.id} className="rounded-xl border border-line p-4">
            <p className="font-semibold">{item.description}</p>
            {item.unclear && <p className="mt-1 text-[13px] text-muted">The tester could not decide: {item.aiSummary}</p>}
            <div className="mt-3 flex gap-3" role="radiogroup" aria-label={`Your decision on ${item.description}`}>
              {(['approved', 'rejected'] as const).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  role="radio"
                  aria-checked={decisions[item.id] === choice}
                  onClick={() => setDecisions((current) => ({ ...current, [item.id]: choice }))}
                  className={`h-10 rounded-full px-5 text-sm font-semibold ring-[1.5px] ring-inset ${
                    decisions[item.id] === choice
                      ? choice === 'approved'
                        ? 'bg-pass text-white ring-pass'
                        : 'bg-fail text-white ring-fail'
                      : 'bg-white text-ink ring-ink hover:bg-mist'
                  }`}
                >
                  {choice === 'approved' ? 'Approve' : 'Request changes'}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {rejecting && (
        <>
          <label htmlFor="review-reason" className={`${labelClass} mt-5`}>
            What needs to change?
          </label>
          <textarea
            id="review-reason"
            rows={3}
            className={`${inputClass} py-3`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={`${freelancerFirst} sees this with the result`}
          />
        </>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-fail/10 px-4 py-3 text-sm text-fail">
          {error}
        </p>
      )}

      <Button type="button" onClick={send} disabled={!decided || pending} className="mt-5 w-full disabled:opacity-50">
        {pending ? 'Sending' : rejecting ? 'Send back for changes' : `Approve and release ${amountText}`}
      </Button>
      <p className="mt-3 text-[13px] text-muted">{dueText}</p>

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
