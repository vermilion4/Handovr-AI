'use client';

import Image from 'next/image';
import { useState } from 'react';
import { Icon } from '@/components/icon';
import { formatMoney } from '@/domain/money';
import type { CheckDisplay } from '@/domain/verification';
import { displayLook } from './check-look';

export interface CheckItem {
  id: string;
  description: string;
  testPlan: string;
  shareCents: number;
  display: CheckDisplay;
  aiSummary: string;
  clientSummary: string;
  evidence: Array<{ id: string; kind: string; caption: string; text: string; hasImage: boolean }>;
}

export function CheckList({
  checks,
  clientFirst,
  viewerIsClient,
}: Readonly<{ checks: CheckItem[]; clientFirst: string; viewerIsClient: boolean }>) {
  const firstProblem = checks.find((check) => check.display === 'failed' || check.display === 'changes_requested');
  const [open, setOpen] = useState<string | null>(firstProblem?.id ?? null);

  return (
    <ul className="divide-y divide-line rounded-2xl bg-white px-5 md:px-6">
      {checks.map((check) => {
        const look = displayLook(check.display, clientFirst, viewerIsClient);
        const expanded = open === check.id;
        return (
          <li key={check.id} className="py-4">
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? null : check.id)}
              className="flex w-full items-center gap-3 text-left"
            >
              <Icon name={look.icon} size={20} className={`${look.tone} ${check.display === 'testing' ? 'motion-safe:animate-spin' : ''}`} />
              <span className="flex-1 text-[15px]">{check.description}</span>
              <span className={`text-[13px] font-semibold ${look.tone}`}>{look.label}</span>
              <Icon name={expanded ? 'expand_less' : 'expand_more'} size={20} className="text-muted" />
            </button>

            {expanded && (
              <div className="mt-3 space-y-3 pl-8 text-sm">
                <p className="text-[13px] text-muted">
                  <span className="font-semibold text-ink">The agreed test:</span> {check.testPlan} ({formatMoney(check.shareCents)})
                </p>
                {check.aiSummary && (
                  <p>
                    <span className="font-semibold">What the tester found:</span> {check.aiSummary}
                  </p>
                )}
                {check.clientSummary && (
                  <p>
                    <span className="font-semibold">{viewerIsClient ? 'You said' : `${clientFirst} said`}:</span> {check.clientSummary}
                  </p>
                )}
                {check.evidence
                  .filter((item) => !item.hasImage)
                  .map((item) => (
                    <p key={item.id} className="text-[13px] text-muted">
                      <span className="font-semibold text-ink">{item.caption}:</span> {item.text}
                    </p>
                  ))}
                <div className="grid gap-3 sm:grid-cols-2">
                  {check.evidence
                    .filter((item) => item.hasImage)
                    .map((item) => (
                      <figure key={item.id}>
                        <Image
                          src={`/api/evidence/${item.id}`}
                          alt={item.caption}
                          width={640}
                          height={400}
                          unoptimized
                          className="h-auto w-full rounded-lg border border-line"
                        />
                        <figcaption className="mt-1 text-xs text-muted">{item.caption}</figcaption>
                      </figure>
                    ))}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
