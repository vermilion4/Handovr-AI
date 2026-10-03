import { PROGRESS_STEPS, type Progress } from '@/domain/progress';

const filled: Record<Progress['tone'], string> = {
  agreed: 'bg-ink',
  held: 'bg-hold',
  paid: 'bg-paypal',
  problem: 'bg-fail',
  ended: 'bg-ghost',
};

const labelColour: Record<Progress['tone'], string> = {
  agreed: 'text-pass',
  held: 'text-pass',
  paid: 'text-pass',
  problem: 'text-muted',
  ended: 'text-fail',
};

/** The four steps one milestone goes through, from agreed to paid, with the ones reached filled in. */
export function ProgressBar({ progress }: Readonly<{ progress: Progress }>) {
  return (
    <div role="img" aria-label={`This milestone is ${progress.label}`}>
      <div className="mb-1 flex text-[9px] leading-none" aria-hidden="true">
        {PROGRESS_STEPS.map((step, index) => (
          <span
            key={step}
            className={`flex-1 text-center ${index < progress.done ? `font-semibold ${labelColour[progress.tone]}` : 'text-muted/60'}`}
          >
            {step}
          </span>
        ))}
      </div>
      <div className="flex h-3 gap-[2px]">
        {PROGRESS_STEPS.map((step, index) => (
          <span
            key={step}
            className={`h-full flex-1 first:rounded-l-full last:rounded-r-full ${
              index < progress.done ? filled[progress.tone] : 'bg-white ring-[1.5px] ring-inset ring-ghost'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
