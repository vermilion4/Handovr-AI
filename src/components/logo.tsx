import Image from 'next/image';

const RATIO = 427 / 96;

export function Logo({ reversed = false, height = 36 }: Readonly<{ reversed?: boolean; height?: number }>) {
  return (
    <Image
      src={reversed ? '/brand/handovr-logo-reversed.svg' : '/brand/handovr-logo.svg'}
      alt="Handovr.ai"
      width={Math.round(height * RATIO)}
      height={height}
      unoptimized
      priority
    />
  );
}
