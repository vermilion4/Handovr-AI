'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Button } from '@/components/button';
import { inputClass, labelClass } from '@/components/field';
import { Icon } from '@/components/icon';
import { formatMoney } from '@/domain/money';
import { signAction } from './actions';
import type { ReviewMilestone } from './review-list';

export function SignDialog({
  open,
  projectId,
  chosen,
  leftUnsigned,
  viewer,
  otherFirst,
  today,
  onClose,
  onSigned,
}: Readonly<{
  open: boolean;
  projectId: string;
  chosen: ReviewMilestone[];
  leftUnsigned: string[];
  viewer: { email: string; role: 'client' | 'freelancer' };
  otherFirst: string;
  today: string;
  onClose: () => void;
  onSigned: (outcome: { signed: number; completed: number }) => void;
}>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const count = chosen.length;
  const countLabel = count === 1 ? '1 milestone' : `${count} milestones`;
  const paid = viewer.role === 'client' ? `${otherFirst} is paid each amount` : 'You are paid each amount';

  function sign() {
    setError('');
    startTransition(async () => {
      const result = await signAction(projectId, chosen.map((milestone) => milestone.versionId), name, agreed);
      if (result.error) {
        setError(result.error);
        return;
      }
      setName('');
      setAgreed(false);
      onSigned({ signed: result.signed ?? chosen.length, completed: result.completed ?? 0 });
    });
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="sign-title"
      className="m-auto w-[min(92vw,520px)] rounded-2xl bg-white p-0 text-ink backdrop:bg-ink/50"
    >
      <div className="p-6 md:p-8">
        <h2 id="sign-title" className="font-display text-2xl font-medium">
          Sign the criteria
        </h2>
        <p className="mt-2 text-sm text-muted">You are signing {countLabel}.</p>

        <ul className="mt-4 space-y-3 rounded-xl bg-mist p-4">
          {chosen.map((milestone) => (
            <li key={milestone.id} className="flex items-center gap-3 text-sm">
              <Icon name="check_circle" size={20} className="text-pass" />
              <span className="flex-1 font-semibold">{milestone.title}</span>
              <span className="text-muted">
                {milestone.criteria.length} checks, {formatMoney(milestone.amountCents)}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-sm leading-relaxed">
          Signing freezes these lists. {paid} when that milestone&apos;s checks all pass.
          {leftUnsigned.length > 0 && ` ${leftUnsigned.join(' and ')} ${leftUnsigned.length === 1 ? 'stays' : 'stay'} unsigned for now.`}
        </p>

        <label htmlFor="sign-name" className={`${labelClass} mt-5`}>
          Type your full name to sign
        </label>
        <input
          id="sign-name"
          className={`${inputClass} h-12`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
        />

        <label className="mt-4 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-[18px] accent-paypal"
            checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)}
          />
          I agree that these checks decide when each payment is released.
        </label>

        <p className="mt-3 text-xs text-muted">
          Recorded as {viewer.email} on {today}.
        </p>

        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-fail/10 px-4 py-3 text-sm text-fail">
            {error}
          </p>
        )}
      </div>

      <div className="flex justify-end gap-3 border-t border-line px-6 py-5 md:px-8">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={sign} disabled={pending || !agreed || name.trim() === ''} className="disabled:opacity-50">
          {pending ? 'Signing' : `Sign ${countLabel}`}
        </Button>
      </div>
    </dialog>
  );
}
