import Link from 'next/link';
import type { ComponentProps } from 'react';

type Variant = 'primary' | 'secondary';

const base =
  'inline-flex h-12 items-center justify-center rounded-full px-7 text-base font-semibold ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paypal';

const variants: Record<Variant, string> = {
  primary: 'bg-paypal text-white hover:bg-[#005fc0]',
  secondary: 'border-[1.5px] border-ink bg-white text-ink hover:bg-mist',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ComponentProps<'button'> & { variant?: Variant }) {
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function ButtonLink({
  variant = 'primary',
  className = '',
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={`${base} ${variants[variant]} ${className}`} {...props} />;
}
