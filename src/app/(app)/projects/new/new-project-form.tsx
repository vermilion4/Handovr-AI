'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { Button } from '@/components/button';
import { inputClass, labelClass } from '@/components/field';
import { Icon } from '@/components/icon';
import { formatMoney, parseAmount } from '@/domain/money';
import { MAX_MILESTONES } from '@/domain/new-project';
import { createProjectAction } from './actions';

interface Draft {
  id: number;
  title: string;
  amount: string;
  brief: string;
}

const blank = (id: number): Draft => ({ id, title: '', amount: '', brief: '' });

export function NewProjectForm() {
  const [title, setTitle] = useState('');
  const [email, setEmail] = useState('');
  const [milestones, setMilestones] = useState<Draft[]>([blank(1)]);
  const [openId, setOpenId] = useState<number | null>(1);
  const [nextId, setNextId] = useState(2);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const total = milestones.reduce((sum, milestone) => sum + (parseAmount(milestone.amount) ?? 0), 0);
  const update = (id: number, patch: Partial<Draft>) =>
    setMilestones((list) => list.map((milestone) => (milestone.id === id ? { ...milestone, ...patch } : milestone)));

  function add() {
    setMilestones((list) => [...list, blank(nextId)]);
    setOpenId(nextId);
    setNextId(nextId + 1);
  }

  function remove(id: number) {
    setMilestones((list) => list.filter((milestone) => milestone.id !== id));
    setOpenId(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    startTransition(async () => {
      const result = await createProjectAction({
        title,
        freelancerEmail: email,
        milestones: milestones.map(({ title, brief, amount }) => ({ title, brief, amount })),
      });
      if (result?.error) setError(result.error);
    });
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="rounded-2xl bg-white p-5 md:p-8">
        <label htmlFor="project-name" className={labelClass}>
          Project name
        </label>
        <input
          id="project-name"
          className={`${inputClass} h-12`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Chen's Bakery website"
        />

        <label htmlFor="freelancer-email" className={`${labelClass} mt-6`}>
          Who is doing the work?
        </label>
        <input
          id="freelancer-email"
          type="email"
          autoComplete="off"
          className={`${inputClass} h-12`}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Their PayPal email"
          aria-describedby="freelancer-email-help"
        />
        <p id="freelancer-email-help" className="mt-2 text-[13px] text-muted">
          Their PayPal email. They get the same checklists to review and sign.
        </p>
      </div>

      <div className="mt-8 flex items-baseline justify-between">
        <h2 className="font-display text-lg font-medium">Milestones</h2>
        <p className="text-[13px] text-muted">
          {milestones.length === 1 ? '1 milestone' : `${milestones.length} milestones`}, {formatMoney(total)} in total
        </p>
      </div>

      <ol className="mt-3 space-y-3">
        {milestones.map((milestone, index) => {
          const amountCents = parseAmount(milestone.amount);
          const prefix = `milestone-${milestone.id}`;

          return openId === milestone.id ? (
            <li key={milestone.id} className="grid grid-cols-[2rem_1fr] rounded-2xl bg-white p-5 ring-[1.5px] ring-paypal md:p-6">
              <span className="pt-8 font-display text-lg font-medium text-paypal">{index + 1}</span>
              <div>
                <div className="grid gap-4 md:grid-cols-[1fr_160px]">
                  <div>
                    <label htmlFor={`${prefix}-name`} className={labelClass}>
                      Milestone name
                    </label>
                    <input
                      id={`${prefix}-name`}
                      className={`${inputClass} h-12`}
                      value={milestone.title}
                      onChange={(event) => update(milestone.id, { title: event.target.value })}
                      placeholder="Contact page"
                    />
                  </div>
                  <div>
                    <label htmlFor={`${prefix}-amount`} className={labelClass}>
                      Amount (CAD)
                    </label>
                    <input
                      id={`${prefix}-amount`}
                      inputMode="decimal"
                      className={`${inputClass} h-12 font-display font-medium`}
                      value={milestone.amount}
                      onChange={(event) => update(milestone.id, { amount: event.target.value })}
                      placeholder="600.00"
                    />
                  </div>
                </div>

                <label htmlFor={`${prefix}-brief`} className={`${labelClass} mt-5`}>
                  What should be delivered?
                </label>
                <textarea
                  id={`${prefix}-brief`}
                  rows={5}
                  className={`${inputClass} py-3 leading-relaxed`}
                  value={milestone.brief}
                  onChange={(event) => update(milestone.id, { brief: event.target.value })}
                  placeholder="Describe it the way you would to the freelancer. Handovr turns this into checks."
                />

                <div className="mt-4 flex items-center justify-between">
                  {milestones.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => remove(milestone.id)}
                      className="flex items-center gap-1.5 text-[13px] text-muted hover:text-fail"
                    >
                      <Icon name="delete" size={18} />
                      Remove milestone
                    </button>
                  ) : (
                    <span />
                  )}
                  <Button type="button" variant="secondary" className="h-10! px-6! text-sm" onClick={() => setOpenId(null)}>
                    Done
                  </Button>
                </div>
              </div>
            </li>
          ) : (
            <li key={milestone.id} className="grid grid-cols-[2rem_1fr_auto_auto] items-center gap-x-4 rounded-2xl bg-white px-5 py-4 md:px-6">
              <span className="font-display text-lg font-medium text-paypal">{index + 1}</span>
              <div className="min-w-0">
                <p className="truncate font-semibold">{milestone.title || 'Untitled milestone'}</p>
                <p className="truncate text-[13px] text-muted">{milestone.brief || 'No description yet'}</p>
              </div>
              <span className="font-display font-medium">{amountCents ? formatMoney(amountCents) : 'No amount'}</span>
              <button
                type="button"
                onClick={() => setOpenId(milestone.id)}
                className="grid size-9 place-items-center rounded-full text-muted hover:bg-mist hover:text-ink"
              >
                <Icon name="edit" size={18} label={`Edit milestone ${index + 1}`} />
              </button>
            </li>
          );
        })}
      </ol>

      {error && (
        <p role="alert" className="mt-5 flex items-start gap-2 rounded-xl bg-fail/10 px-4 py-3 text-sm text-fail">
          <Icon name="error" size={18} />
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <Button type="button" variant="secondary" onClick={add} disabled={milestones.length >= MAX_MILESTONES} className="disabled:opacity-50">
          Add another milestone
        </Button>
        <Button type="submit" disabled={pending} className="disabled:opacity-60 max-md:w-full">
          {pending ? 'Starting the drafts' : 'Draft criteria'}
        </Button>
      </div>
    </form>
  );
}
