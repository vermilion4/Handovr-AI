'use client';

import { useState, useTransition } from 'react';
import { Button, ButtonLink } from '@/components/button';
import { inputClass, labelClass } from '@/components/field';
import { Icon } from '@/components/icon';
import {
  MAX_CRITERIA,
  describeDiff,
  diffCriteria,
  type CriterionCategory,
  type CriterionFields,
  type CriterionKind,
} from '@/domain/criteria';
import { formatMoney, parseAmount } from '@/domain/money';
import { rewriteAction, saveEditAction } from './actions';

interface Row {
  key: string;
  description: string;
  testPlan: string;
  kind: CriterionKind;
  category: CriterionCategory | null;
  share: string;
}

const toRow = (check: CriterionFields): Row => ({
  key: check.key,
  description: check.description,
  testPlan: check.testPlan,
  kind: check.kind,
  category: check.category,
  share: formatMoney(check.shareCents).replace(/[$,]/g, ''),
});

const toFields = (row: Row): CriterionFields => ({
  key: row.key,
  description: row.description,
  testPlan: row.testPlan,
  kind: row.kind,
  category: row.category,
  shareCents: parseAmount(row.share) ?? 0,
});

export function EditForm({
  projectId,
  milestoneId,
  baseVersionId,
  amountCents,
  original,
  otherFirst,
  clientFirst,
  viewerIsClient,
}: Readonly<{
  projectId: string;
  milestoneId: string;
  baseVersionId: string;
  amountCents: number;
  original: CriterionFields[];
  otherFirst: string;
  clientFirst: string;
  viewerIsClient: boolean;
}>) {
  const [rows, setRows] = useState<Row[]>(original.map(toRow));
  const [request, setRequest] = useState('');
  const [rewritten, setRewritten] = useState<string[] | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [rewriting, startRewrite] = useTransition();
  const [saving, startSave] = useTransition();

  const fields = rows.map(toFields);
  const total = fields.reduce((sum, check) => sum + check.shareCents, 0);
  const changeCount = describeDiff(diffCriteria(original, fields), fields, amountCents).length;
  const backHref = `/projects/${projectId}/criteria`;
  const humanLabel = viewerIsClient ? 'You decide' : `${clientFirst} decides`;

  const update = (key: string, patch: Partial<Row>) =>
    setRows((list) => list.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  function setKind(row: Row, kind: CriterionKind) {
    update(row.key, { kind, category: kind === 'machine' ? (row.category ?? 'function') : null });
  }

  function addCheck() {
    setRows((list) => [
      ...list,
      { key: crypto.randomUUID(), description: '', testPlan: '', kind: 'human', category: null, share: '' },
    ]);
  }

  function rewrite() {
    setError('');
    startRewrite(async () => {
      const result = await rewriteAction(projectId, milestoneId, fields, request);
      if (result.error || !result.items) {
        setError(result.error ?? 'Handovr could not rewrite the list.');
        return;
      }
      setRewritten(describeDiff(diffCriteria(fields, result.items), result.items, amountCents));
      setRows(result.items.map(toRow));
    });
  }

  function save() {
    setError('');
    startSave(async () => {
      const result = await saveEditAction(projectId, milestoneId, baseVersionId, fields, reason);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <>
      <div className="mt-6 grid gap-6 pb-36 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div>
          <ul className="divide-y divide-line rounded-2xl bg-white px-4 md:px-6">
            {rows.map((row, index) => (
              <li key={row.key} className="grid gap-3 py-5 md:grid-cols-[1fr_170px_auto]">
                <div className="space-y-2">
                  <label className="sr-only" htmlFor={`check-${row.key}`}>
                    Check {index + 1}
                  </label>
                  <input
                    id={`check-${row.key}`}
                    className={`${inputClass} h-11`}
                    value={row.description}
                    onChange={(event) => update(row.key, { description: event.target.value })}
                    placeholder="What must be true"
                  />
                  <label className="sr-only" htmlFor={`test-${row.key}`}>
                    How check {index + 1} is tested
                  </label>
                  <textarea
                    id={`test-${row.key}`}
                    rows={2}
                    className={`${inputClass} py-2.5 text-[13px] leading-relaxed`}
                    value={row.testPlan}
                    onChange={(event) => update(row.key, { testPlan: event.target.value })}
                    placeholder="How it is checked, and what counts as a pass"
                  />
                </div>

                <div className="space-y-2">
                  <label className="sr-only" htmlFor={`share-${row.key}`}>
                    Share of check {index + 1} in dollars
                  </label>
                  <input
                    id={`share-${row.key}`}
                    inputMode="decimal"
                    className={`${inputClass} h-11 font-display font-medium`}
                    value={row.share}
                    onChange={(event) => update(row.key, { share: event.target.value })}
                    placeholder="0.00"
                  />
                  <label className="sr-only" htmlFor={`kind-${row.key}`}>
                    Who decides check {index + 1}
                  </label>
                  <select
                    id={`kind-${row.key}`}
                    className="w-full bg-transparent text-xs text-muted"
                    value={row.kind}
                    onChange={(event) => setKind(row, event.target.value as CriterionKind)}
                  >
                    <option value="machine">Tested automatically</option>
                    <option value="human">{humanLabel}</option>
                  </select>
                </div>

                <button
                  type="button"
                  disabled={rows.length === 1}
                  onClick={() => setRows((list) => list.filter((candidate) => candidate.key !== row.key))}
                  className="grid size-11 place-items-center rounded-full text-muted hover:bg-mist hover:text-fail disabled:opacity-30"
                >
                  <Icon name="delete" size={20} label={`Remove check ${index + 1}`} />
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 px-2">
            <button
              type="button"
              onClick={addCheck}
              disabled={rows.length >= MAX_CRITERIA}
              className="flex items-center gap-1.5 text-sm font-semibold text-paypal disabled:opacity-40"
            >
              <Icon name="add" size={18} />
              Add a check
            </button>
            <p className={`text-sm font-semibold ${total === amountCents ? 'text-pass' : 'text-fail'}`} aria-live="polite">
              Shares add up to {formatMoney(total)}
              {total !== amountCents && ` of ${formatMoney(amountCents)}`}
            </p>
          </div>

          <label htmlFor="edit-reason" className={`${labelClass} mt-8`}>
            Why are you changing it? (optional)
          </label>
          <input
            id="edit-reason"
            className={`${inputClass} h-12`}
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            placeholder={`${otherFirst} sees this next to your changes`}
          />
        </div>

        <aside className="h-fit rounded-2xl bg-white p-5 md:p-6">
          <h2 className="flex items-center gap-2 font-semibold">
            <Icon name="smart_toy" size={20} className="text-paypal" />
            Ask Handovr to change it
          </h2>
          <label htmlFor="rewrite-request" className="mt-2 block text-[13px] text-muted">
            Describe the change in your own words. Handovr rewrites the checks and their tests.
          </label>
          <textarea
            id="rewrite-request"
            rows={4}
            className={`${inputClass} mt-3 py-3 text-sm leading-relaxed`}
            value={request}
            maxLength={1000}
            onChange={(event) => setRequest(event.target.value)}
            placeholder="Add a check that a map shows the shop, and allow 4 seconds on a phone connection."
          />
          <Button type="button" onClick={rewrite} disabled={rewriting || request.trim().length < 5} className="mt-3 w-full disabled:opacity-50">
            Rewrite the list
          </Button>

          {rewritten && (
            <div className="mt-5" aria-live="polite">
              <h3 className="text-[13px] font-semibold">What Handovr changed</h3>
              {rewritten.length === 0 ? (
                <p className="mt-2 text-[13px] text-muted">Nothing. Try describing the change another way.</p>
              ) : (
                <ul className="mt-2 space-y-1.5 text-[13px]">
                  {rewritten.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-white">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-24">
          <div className="max-w-[60ch]">
            {error ? (
              <p role="alert" className="text-sm font-semibold text-fail">
                {error}
              </p>
            ) : (
              <>
                <p className="font-semibold">
                  {changeCount === 0 ? 'No changes yet' : changeCount === 1 ? '1 change not yet sent' : `${changeCount} changes not yet sent`}
                </p>
                <p className="text-[13px] text-muted">
                  Sending clears any signatures on this milestone until you both sign the new list.
                </p>
              </>
            )}
          </div>
          <div className="flex gap-3 max-md:w-full">
            <ButtonLink href={backHref} variant="secondary" className="max-md:flex-1">
              Cancel
            </ButtonLink>
            <Button type="button" onClick={save} disabled={saving || changeCount === 0} className="disabled:opacity-50 max-md:flex-1">
              {saving ? 'Sending' : `Save and send to ${otherFirst}`}
            </Button>
          </div>
        </div>
      </div>

      {rewriting && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/50 px-4">
          <div role="status" className="w-full max-w-[420px] rounded-2xl bg-white p-8">
            <div className="flex items-center gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-tint text-paypal">
                <Icon name="progress_activity" size={26} className="motion-safe:animate-spin" />
              </span>
              <h2 className="font-display text-xl font-medium">Handovr is rewriting the checks</h2>
            </div>
            <p className="mt-4 text-sm text-muted">This takes a few seconds. The edits you already made are kept.</p>
          </div>
        </div>
      )}
    </>
  );
}
