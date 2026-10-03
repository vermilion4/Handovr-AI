'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { ResultDialog } from '@/components/result-dialog';
import type { ContractStatus } from '@/domain/contract';
import type { CriterionFields, ListDiff } from '@/domain/criteria';
import { answeredFeedback, signedFeedback, type Feedback } from '@/domain/feedback';
import { formatMoney } from '@/domain/money';
import { acceptChangesAction, declineChangesAction } from './actions';
import { SignDialog } from './sign-dialog';

export interface ReviewMilestone {
  id: string;
  position: number;
  title: string;
  amountCents: number;
  status: ContractStatus;
  versionId: string;
  reason: string;
  criteria: CriterionFields[];
  diff: ListDiff | null;
}

function statusLine(status: ContractStatus, other: string) {
  switch (status) {
    case 'changes_suggested':
      return { icon: 'rate_review', text: `Changes suggested by ${other}`, tone: 'font-semibold text-ink' };
    case 'signed_by_viewer':
      return { icon: 'schedule', text: `You signed. Waiting for ${other}`, tone: 'text-muted' };
    case 'signed':
      return { icon: 'check_circle', text: 'Signed by both', tone: 'text-pass' };
    default:
      return { icon: 'edit', text: 'Ready to sign', tone: 'text-ink' };
  }
}

const tag = 'ml-2 rounded-full bg-hold/30 px-2 py-0.5 align-middle text-[11px] font-semibold text-ink';

export function ReviewList({
  projectId,
  milestones,
  viewer,
  otherFirst,
  clientFirst,
  today,
}: Readonly<{
  projectId: string;
  milestones: ReviewMilestone[];
  viewer: { email: string; role: 'client' | 'freelancer' };
  otherFirst: string;
  clientFirst: string;
  today: string;
}>) {
  const router = useRouter();
  const suggested = milestones.filter((milestone) => milestone.status === 'changes_suggested');
  const [expanded, setExpanded] = useState<Set<string>>(new Set(suggested.map((milestone) => milestone.id)));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [signing, setSigning] = useState(false);
  const [feedback, setFeedback] = useState<{ result: Feedback; next?: { label: string; href: string } } | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const signable = milestones.filter((milestone) => milestone.status === 'ready_to_sign');
  const chosen = signable.filter((milestone) => selected.has(milestone.id));
  const chosenTotal = chosen.reduce((total, milestone) => total + milestone.amountCents, 0);
  const waitingOnOther = milestones.filter((milestone) => milestone.status === 'signed_by_viewer').length;
  const humanLabel = viewer.role === 'client' ? 'You decide' : `${clientFirst} decides`;

  function answer(versionId: string, accepted: boolean) {
    startTransition(async () => {
      const result = await (accepted ? acceptChangesAction : declineChangesAction)(projectId, versionId);
      if (result.error) {
        setFeedback({ result: { tone: 'error', title: 'That did not go through', message: result.error } });
        return;
      }
      setFeedback({ result: answeredFeedback(accepted, otherFirst) });
      router.refresh();
    });
  }

  return (
    <>
      {suggested.length > 0 && (
        <p className="mt-5 flex items-start gap-3 rounded-xl bg-hold/25 px-5 py-4 text-sm font-semibold">
          <Icon name="rate_review" size={20} />
          {otherFirst} suggested changes to {suggested.map((milestone) => milestone.title).join(' and ')}. Accept them or
          change the list again, then sign.
        </p>
      )}

      <ol className="mt-5 space-y-3 pb-32">
        {milestones.map((milestone) => {
          const line = statusLine(milestone.status, otherFirst);
          const open = expanded.has(milestone.id);
          const canTick = milestone.status === 'ready_to_sign';
          const canEdit = milestone.status === 'ready_to_sign' || milestone.status === 'signed_by_viewer';
          const editHref = `/projects/${projectId}/criteria/${milestone.id}/edit`;

          return (
            <li key={milestone.id} className="rounded-2xl bg-white">
              <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-5 md:grid-cols-[auto_1.2fr_1fr_1.4fr_auto] md:px-6">
                <input
                  type="checkbox"
                  className="size-[18px] accent-paypal disabled:opacity-40"
                  aria-label={`Sign ${milestone.title}`}
                  disabled={!canTick}
                  checked={canTick && selected.has(milestone.id)}
                  onChange={() => setSelected((set) => toggle(set, milestone.id))}
                />
                <h2 className="font-semibold">
                  <span className="mr-2 font-display font-medium text-paypal">{milestone.position}</span>
                  {milestone.title}
                </h2>
                <p className="text-[13px] text-muted max-md:col-start-2">
                  {milestone.criteria.length} checks, {formatMoney(milestone.amountCents)}
                </p>
                <p className={`flex items-center gap-1.5 text-[13px] max-md:col-start-2 ${line.tone}`}>
                  <Icon name={line.icon} size={18} />
                  {line.text}
                </p>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={`checks-${milestone.id}`}
                  onClick={() => setExpanded((set) => toggle(set, milestone.id))}
                  className="grid size-9 place-items-center rounded-full text-muted hover:bg-mist hover:text-ink max-md:col-start-3 max-md:row-start-1"
                >
                  <Icon name={open ? 'expand_less' : 'expand_more'} size={22} label={`${open ? 'Hide' : 'Show'} the checks for ${milestone.title}`} />
                </button>
              </div>

              {open && (
                <div id={`checks-${milestone.id}`} className="border-t border-line px-5 pb-5 md:px-6">
                  <div className="grid grid-cols-[1fr_200px_100px] gap-4 border-b border-line py-3 text-xs text-muted max-md:hidden">
                    <span>Criterion</span>
                    <span>How it is checked</span>
                    <span className="text-right">Share</span>
                  </div>

                  <ul className="divide-y divide-line">
                    {milestone.criteria.map((check) => {
                      const before = milestone.diff?.changed[check.key];
                      const added = milestone.diff?.added.includes(check.key);
                      const oldShare = milestone.diff?.previousShares[check.key];
                      return (
                        <li key={check.key} className="grid gap-x-4 gap-y-2 py-4 md:grid-cols-[1fr_200px_100px] md:items-center">
                          <div>
                            {before && before.description !== check.description && (
                              <p className="text-[13px] text-muted">
                                <span className="sr-only">Was: </span>
                                <span className="line-through">{before.description}</span>
                              </p>
                            )}
                            <p>
                              {check.description}
                              {before && <span className={tag}>Changed</span>}
                              {added && <span className={tag}>Added</span>}
                            </p>
                            <p className="mt-0.5 text-[13px] text-muted">{check.testPlan}</p>
                          </div>
                          <p className="flex items-center gap-2 text-[13px]">
                            <Icon name={check.kind === 'machine' ? 'smart_toy' : 'person'} size={18} className="text-paypal" />
                            {check.kind === 'machine' ? 'Tested automatically' : humanLabel}
                          </p>
                          <p className="font-display font-medium md:text-right">
                            {oldShare !== undefined && (
                              <span className="mr-2 text-[13px] text-muted md:mr-0 md:block">
                                <span className="sr-only">Was </span>
                                <span className="line-through">{formatMoney(oldShare)}</span>
                                <span className="sr-only">, now </span>
                              </span>
                            )}
                            {formatMoney(check.shareCents)}
                          </p>
                        </li>
                      );
                    })}
                    {milestone.diff?.removed.map((check) => (
                      <li key={check.key} className="py-4 text-[13px] text-muted">
                        <span className="line-through">{check.description}</span>
                        <span className={tag}>Removed</span>
                      </li>
                    ))}
                  </ul>

                  {milestone.status === 'changes_suggested' ? (
                    <div className="mt-2">
                      {milestone.reason && (
                        <p className="mb-4 max-w-[70ch] text-[13px]">
                          <span className="font-semibold">{otherFirst}:</span> {milestone.reason}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-3">
                        <Button type="button" disabled={pending} onClick={() => answer(milestone.versionId, true)} className="h-10! px-6! text-sm disabled:opacity-60">
                          Accept changes
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={pending}
                          onClick={() => answer(milestone.versionId, false)}
                          className="h-10! px-6! text-sm disabled:opacity-60"
                        >
                          Decline changes
                        </Button>
                        <Link href={editHref} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-paypal">
                          <Icon name="edit" size={18} />
                          Edit these checks
                        </Link>
                      </div>
                      <p className="mt-3 text-[13px] text-muted">
                        Declining puts the list back as it was before {otherFirst}&apos;s changes and sends it to {otherFirst}.
                      </p>
                    </div>
                  ) : (
                    canEdit && (
                      <Link href={editHref} className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-paypal">
                        <Icon name="edit" size={18} />
                        Edit these checks
                      </Link>
                    )
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-white">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-24">
          <div>
            <p className="font-semibold">
              {chosen.length} of {milestones.length} milestones selected
            </p>
            <p className="text-[13px] text-muted">
              {chosen.length > 0
                ? `${chosen.map((milestone) => milestone.title).join(' and ')}, ${formatMoney(chosenTotal)}`
                : signable.length > 0
                  ? 'Tick the milestones you are happy with.'
                  : waitingOnOther > 0
                    ? `Waiting for ${otherFirst} to sign.`
                    : 'Nothing is waiting for your signature.'}
            </p>
          </div>
          <Button type="button" disabled={chosen.length === 0} onClick={() => setSigning(true)} className="disabled:opacity-50 max-md:w-full">
            Sign selected
          </Button>
        </div>
      </div>

      <SignDialog
        open={signing}
        projectId={projectId}
        chosen={chosen}
        leftUnsigned={signable.filter((milestone) => !selected.has(milestone.id)).map((milestone) => milestone.title)}
        viewer={viewer}
        otherFirst={otherFirst}
        today={today}
        onClose={() => setSigning(false)}
        onSigned={(outcome) => {
          setSigning(false);
          setSelected(new Set());
          setFeedback({
            result: signedFeedback({ ...outcome, otherFirst, viewerRole: viewer.role }),
            next:
              viewer.role === 'client' && outcome.completed > 0
                ? { label: 'Go to funding', href: `/projects/${projectId}` }
                : { label: 'Back to projects', href: '/projects' },
          });
          router.refresh();
        }}
      />

      <ResultDialog
        feedback={feedback?.result ?? null}
        open={feedback !== null}
        next={feedback?.next}
        closeLabel={feedback?.next ? 'Stay here' : 'Close'}
        onClose={() => setFeedback(null)}
      />
    </>
  );
}
