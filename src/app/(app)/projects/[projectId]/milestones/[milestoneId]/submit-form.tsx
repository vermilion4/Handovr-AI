'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { Button } from '@/components/button';
import { inputClass, labelClass } from '@/components/field';
import { Icon } from '@/components/icon';
import { submitWorkAction } from './actions';

export function SubmitForm({
  projectId,
  milestoneId,
  previousUrl,
  attemptLabel,
}: Readonly<{ projectId: string; milestoneId: string; previousUrl: string; attemptLabel: string }>) {
  const router = useRouter();
  const [url, setUrl] = useState(previousUrl);
  const [repoUrl, setRepoUrl] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    startTransition(async () => {
      const result = await submitWorkAction(projectId, milestoneId, url, repoUrl);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor="live-url" className={labelClass}>
        Live link
      </label>
      <div className="relative">
        <Icon name="link" size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
        <input
          id="live-url"
          type="url"
          inputMode="url"
          className={`${inputClass} h-12 pl-11`}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://your-preview.example/contact"
          aria-describedby="live-url-help"
        />
      </div>
      <p id="live-url-help" className="mt-2 text-[13px] text-muted">
        The tester opens this address, so it must load without a login.
      </p>

      <label htmlFor="repo-url" className={`${labelClass} mt-5`}>
        Repository link (optional)
      </label>
      <div className="relative">
        <Icon name="code" size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
        <input
          id="repo-url"
          type="url"
          inputMode="url"
          className={`${inputClass} h-12 pl-11`}
          value={repoUrl}
          onChange={(event) => setRepoUrl(event.target.value)}
          placeholder="https://github.com/you/project"
        />
      </div>
      <p className="mt-2 text-[13px] text-muted">Kept for handover. It is not tested.</p>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-fail/10 px-4 py-3 text-sm text-fail">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="mt-6 disabled:opacity-60 max-md:w-full">
        {pending ? 'Submitting' : 'Submit for testing'}
      </Button>
      <p className="mt-2 text-[13px] text-muted">{attemptLabel}</p>
    </form>
  );
}
