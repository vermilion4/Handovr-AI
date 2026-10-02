type Segment = { amountCents: number; kind: 'released' | 'held' | 'none' };

const fill: Record<Segment['kind'], string> = {
  released: 'bg-paypal',
  held: 'bg-hold',
  none: 'bg-white ring-[1.5px] ring-inset ring-ghost',
};

const meaning: Record<Segment['kind'], string> = {
  released: 'released',
  held: 'held',
  none: 'not yet funded',
};

export function MoneyBar({ segments }: { segments: Segment[] }) {
  if (segments.length === 0) return null;
  const label = segments.map((s, i) => `Milestone ${i + 1} ${meaning[s.kind]}`).join(', ');
  return (
    <div className="flex h-3 w-full gap-[3px]" role="img" aria-label={label}>
      {segments.map((segment, index) => (
        <span
          key={index}
          className={`h-full rounded-full ${fill[segment.kind]}`}
          style={{ flexGrow: Math.max(segment.amountCents, 1), flexBasis: 0 }}
        />
      ))}
    </div>
  );
}
