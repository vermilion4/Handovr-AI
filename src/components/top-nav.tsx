'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { signOut } from '@/app/sign-in/actions';
import { initials } from '@/domain/person';
import { Icon } from './icon';
import { Logo } from './logo';

interface NavUser {
  name: string;
  email: string;
  role: 'client' | 'freelancer';
}

const LINKS = [
  { key: 'projects', label: 'Projects', href: '/projects', icon: 'folder_open' },
  { key: 'ledger', label: 'Ledger', href: '/ledger', icon: 'receipt_long' },
] as const;

export function TopNav({ user, active }: { user: NavUser; active: 'projects' | 'ledger' }) {
  const [open, setOpen] = useState<'account' | 'menu' | null>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  // Escape closes whichever menu is open and returns focus to the button that opened it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      (open === 'account' ? accountButton : menuButton).current?.focus();
      setOpen(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);
  const roleLabel = user.role === 'client' ? 'Client' : 'Freelancer';
  const avatar = user.role === 'client' ? 'bg-tint text-ink' : 'bg-paypal text-white';

  return (
    <header className="relative z-20">
      <div className="border-b border-line bg-white">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-10 px-4 md:h-[72px] md:px-24">
        <Link href="/projects" aria-label="Handovr.ai, go to projects">
          <Logo />
        </Link>

        <nav className="hidden gap-9 md:flex" aria-label="Main">
          {LINKS.map((link) => (
            <Link
              key={link.key}
              href={link.href}
              aria-current={active === link.key ? 'page' : undefined}
              className={active === link.key ? 'text-[15px] font-semibold text-ink' : 'text-[15px] text-muted hover:text-ink'}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-4">
          <button
            ref={menuButton}
            type="button"
            className="md:hidden"
            aria-label={open === 'menu' ? 'Close menu' : 'Open menu'}
            aria-expanded={open === 'menu'}
            aria-controls="main-menu"
            onClick={() => setOpen(open === 'menu' ? null : 'menu')}
          >
            <Icon name={open === 'menu' ? 'close' : 'menu'} size={24} />
          </button>

          <div className="hidden text-right md:block">
            <div className="text-sm font-semibold">{user.name}</div>
            <div className="text-xs text-muted">{roleLabel}</div>
          </div>

          <button
            ref={accountButton}
            type="button"
            aria-label="Account menu"
            aria-haspopup="true"
            aria-controls="account-menu"
            aria-expanded={open === 'account'}
            onClick={() => setOpen(open === 'account' ? null : 'account')}
            className={`grid size-8 place-items-center rounded-full text-[13px] font-semibold md:size-9 ${avatar} ${
              open === 'account' ? 'ring-2 ring-paypal ring-offset-2' : ''
            } max-md:pointer-events-none`}
          >
            {initials(user.name)}
          </button>
        </div>
      </div>
      </div>

      {open && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className={`fixed inset-0 -z-10 cursor-default ${open === 'menu' ? 'bg-ink/50' : ''}`}
          onClick={() => setOpen(null)}
        />
      )}

      {open === 'account' && (
        <div id="account-menu" className="absolute right-24 top-[68px] hidden w-[260px] rounded-xl border border-line bg-white p-2 shadow-[0_8px_24px_rgba(0,28,100,0.14)] md:block">
          <div className="px-3 pb-3 pt-2">
            <div className="text-[15px] font-semibold">{user.name}</div>
            <div className="text-xs text-muted">{roleLabel}, {user.email}</div>
          </div>
          <div className="border-t border-line pt-2">
            <form action={signOut}>
              <button type="submit" className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-[15px] hover:bg-mist">
                <Icon name="logout" /> Sign out
              </button>
            </form>
          </div>
        </div>
      )}

      {open === 'menu' && (
        <div id="main-menu" className="absolute inset-x-0 top-14 rounded-b-[20px] bg-white px-2 pb-4 md:hidden">
          <div className="flex items-center gap-3 border-b border-line px-2 py-4">
            <span className={`grid size-11 place-items-center rounded-full text-[15px] font-semibold ${avatar}`}>
              {initials(user.name)}
            </span>
            <div>
              <div className="font-semibold">{user.name}</div>
              <div className="text-[13px] text-muted">{roleLabel}, {user.email}</div>
            </div>
          </div>
          <nav className="pt-3" aria-label="Main">
            {LINKS.map((link) => (
              <Link
                key={link.key}
                href={link.href}
                onClick={() => setOpen(null)}
                aria-current={active === link.key ? 'page' : undefined}
                className={`flex h-[52px] items-center gap-3 rounded-xl px-4 ${active === link.key ? 'bg-tint font-semibold' : ''}`}
              >
                <Icon name={link.icon} size={22} className={active === link.key ? 'text-paypal' : ''} />
                {link.label}
              </Link>
            ))}
          </nav>
          <form action={signOut} className="mt-2 border-t border-line pt-2">
            <button type="submit" className="flex h-[52px] w-full items-center gap-3 rounded-xl px-4">
              <Icon name="logout" size={22} /> Sign out
            </button>
          </form>
        </div>
      )}
    </header>
  );
}
