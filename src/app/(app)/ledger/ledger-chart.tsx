'use client';

import { AllCommunityModule, ModuleRegistry } from 'ag-charts-community';
import { AgCharts } from 'ag-charts-react';
import type { LedgerWeek } from '@/domain/ledger';

ModuleRegistry.registerModules([AllCommunityModule]);

const shortDay = new Intl.DateTimeFormat('en-CA', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function LedgerChart({ weeks, client }: Readonly<{ weeks: LedgerWeek[]; client: boolean }>) {
  const data = weeks.map((week) => ({
    week: shortDay.format(new Date(`${week.weekStart}T00:00:00Z`)),
    held: week.heldCents / 100,
    released: week.releasedCents / 100,
    returned: week.returnedCents / 100,
  }));
  const series = [
    { type: 'bar' as const, xKey: 'week', yKey: 'held', yName: client ? 'Held' : 'Held for you', fill: '#ffc439' },
    { type: 'bar' as const, xKey: 'week', yKey: 'released', yName: client ? 'Released' : 'Paid to you', fill: '#0070e0' },
    ...(client ? [{ type: 'bar' as const, xKey: 'week', yKey: 'returned', yName: 'Holds cancelled', fill: '#d9dee8' }] : []),
  ];
  return (
    <div className="h-[280px]">
      <AgCharts
        options={{
          data,
          series,
          background: { visible: false },
          axes: {
            x: { type: 'category', position: 'bottom' },
            y: { type: 'number', position: 'left', label: { formatter: ({ value }) => `$${value}` } },
          },
          legend: { position: 'bottom' },
        }}
      />
    </div>
  );
}
