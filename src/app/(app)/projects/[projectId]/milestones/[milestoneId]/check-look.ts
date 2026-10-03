import type { CheckDisplay } from '@/domain/verification';

export function displayLook(display: CheckDisplay, clientFirst: string, viewerIsClient: boolean) {
  const yours = viewerIsClient ? 'Your call' : `${clientFirst} decides`;
  const looks: Record<CheckDisplay, { icon: string; label: string; tone: string; bar: string }> = {
    passed: { icon: 'check_circle', label: 'Passed', tone: 'text-pass', bar: 'bg-paypal' },
    approved: { icon: 'check_circle', label: 'Approved', tone: 'text-pass', bar: 'bg-paypal' },
    failed: { icon: 'cancel', label: 'Failed', tone: 'text-fail', bar: 'bg-fail/15 ring-[1.5px] ring-inset ring-fail' },
    changes_requested: { icon: 'cancel', label: 'Changes requested', tone: 'text-fail', bar: 'bg-fail/15 ring-[1.5px] ring-inset ring-fail' },
    unclear: { icon: 'help', label: `Unclear, ${yours.toLowerCase()}`, tone: 'text-ink', bar: 'bg-white ring-[1.5px] ring-inset ring-ink' },
    yours: { icon: 'person', label: yours, tone: 'text-ink', bar: 'bg-white ring-[1.5px] ring-inset ring-ink' },
    testing: { icon: 'progress_activity', label: 'Testing now', tone: 'text-paypal', bar: 'bg-hold' },
    queued: { icon: 'schedule', label: 'Queued', tone: 'text-muted', bar: 'bg-hold' },
    not_started: { icon: 'schedule', label: 'Not tested yet', tone: 'text-muted', bar: 'bg-hold' },
  };
  return looks[display];
}
