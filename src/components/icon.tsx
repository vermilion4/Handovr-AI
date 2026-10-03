export function Icon({
  name,
  size = 20,
  className = '',
  label,
}: {
  name: string;
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={`material-symbols-rounded select-none leading-none ${name === 'progress_activity' ? 'motion-safe:animate-spin' : ''} ${className}`}
      style={{ fontSize: size }}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      {name}
    </span>
  );
}
