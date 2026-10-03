'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import type { Feedback } from '@/domain/feedback';
import { Button, ButtonLink } from './button';
import { Icon } from './icon';

const LOOK: Record<Feedback['tone'], { icon: string; badge: string }> = {
  success: { icon: 'check_circle', badge: 'bg-pass/10 text-pass' },
  warning: { icon: 'warning', badge: 'bg-hold/30 text-ink' },
  error: { icon: 'error', badge: 'bg-fail/10 text-fail' },
};

/** A modal that tells the person how an action went, with an optional next step. */
export function ResultDialog({
  feedback,
  open,
  onClose,
  next,
  closeLabel = 'Close',
}: Readonly<{
  feedback: Feedback | null;
  open: boolean;
  onClose: () => void;
  next?: { label: string; href: string };
  closeLabel?: string;
}>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && feedback && !element.open) element.showModal();
    if ((!open || !feedback) && element.open) element.close();
  }, [open, feedback]);

  const look = LOOK[feedback?.tone ?? 'success'];

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      role={feedback?.tone === 'error' ? 'alertdialog' : 'dialog'}
      aria-labelledby={titleId}
      aria-describedby={messageId}
      className="m-auto w-[min(92vw,440px)] rounded-2xl bg-white p-0 text-ink backdrop:bg-ink/50"
    >
      {feedback && (
        <>
          <div className="px-6 pb-6 pt-8 text-center md:px-8">
            <span className={`mx-auto grid size-16 place-items-center rounded-full ${look.badge}`}>
              <Icon name={look.icon} size={36} />
            </span>
            <h2 id={titleId} className="mt-5 font-display text-2xl font-medium">
              {feedback.title}
            </h2>
            <p id={messageId} className="mt-3 text-sm leading-relaxed text-muted">
              {feedback.message}
            </p>
          </div>
          <div className="flex flex-col-reverse gap-3 border-t border-line px-6 py-5 sm:flex-row sm:justify-center md:px-8">
            <Button type="button" variant={next ? 'secondary' : 'primary'} onClick={onClose} autoFocus={!next}>
              {closeLabel}
            </Button>
            {next && (
              <ButtonLink href={next.href} autoFocus>
                {next.label}
              </ButtonLink>
            )}
          </div>
        </>
      )}
    </dialog>
  );
}

/** A result dialog shown once when a page is reached with a result in its address, which it then removes. */
export function AddressResultDialog({
  feedback,
  next,
  closeLabel,
}: Readonly<{ feedback: Feedback; next?: { label: string; href: string }; closeLabel?: string }>) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(true);

  return (
    <ResultDialog
      feedback={feedback}
      open={open}
      next={next}
      closeLabel={closeLabel}
      onClose={() => {
        setOpen(false);
        router.replace(pathname, { scroll: false });
      }}
    />
  );
}
