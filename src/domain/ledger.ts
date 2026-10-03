import type { PaymentStatus, PaymentType } from './payments';

type Role = 'client' | 'freelancer';

export interface LedgerEvent {
  id: string;
  at: Date;
  projectTitle: string;
  milestoneTitle: string;
  counterpartName: string;
  type: PaymentType;
  status: PaymentStatus;
  amountCents: number;
  /** The milestone amount the hold covers, without PayPal's fee. */
  holdAmountCents: number;
  paypalId: string | null;
  detail: string;
}

export interface LedgerRow {
  id: string;
  at: Date;
  project: string;
  milestone: string;
  icon: string;
  label: string;
  amountCents: number;
  reference: string;
  problem: boolean;
}

const SHOWN: ReadonlySet<PaymentStatus> = new Set(['sent', 'completed', 'failed']);

const ICONS: Record<PaymentType, string> = {
  hold: 'lock',
  renew: 'autorenew',
  capture: 'task_alt',
  payout: 'payments',
  void: 'undo',
};

const FAILED: Record<PaymentType, string> = {
  hold: 'Hold failed',
  renew: 'Hold could not be renewed',
  capture: 'Capture failed',
  payout: 'Payout failed, trying again',
  void: 'Hold could not be cancelled',
};

function label(event: LedgerEvent, role: Role): string {
  if (event.status === 'failed') return FAILED[event.type];
  const client = role === 'client';
  const other = event.counterpartName.split(' ')[0];

  switch (event.type) {
    case 'hold':
      return client ? 'Hold placed' : 'Hold placed for you';
    case 'renew':
      return 'Hold renewed';
    case 'capture':
      return 'Payment captured';
    case 'void':
      return client ? 'Hold cancelled, nothing was taken' : 'Hold cancelled';
    case 'payout':
      if (event.status === 'sent') return client ? `Payout to ${other} on its way` : 'Payment on its way to you';
      if (event.detail === 'unclaimed') {
        return client ? `Paid out to ${other}, waiting to be claimed` : 'Paid to you, waiting for you to claim it in PayPal';
      }
      return client ? `Paid out to ${other}` : 'Paid to you';
  }
}

export function ledgerRows(events: LedgerEvent[], role: Role): LedgerRow[] {
  return events
    .filter((event) => SHOWN.has(event.status) && !(role === 'freelancer' && event.type === 'capture'))
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .map((event) => ({
      id: event.id,
      at: event.at,
      project: event.projectTitle,
      milestone: event.milestoneTitle,
      icon: event.status === 'failed' ? 'error' : ICONS[event.type],
      label: label(event, role),
      amountCents: role === 'freelancer' && event.type !== 'payout' ? event.holdAmountCents : event.amountCents,
      reference: event.paypalId ?? '',
      problem: event.status === 'failed',
    }));
}

export function ledgerTotals(
  events: LedgerEvent[],
  activeHolds: Array<{ amountCents: number; totalCents: number }>,
  role: Role,
): { heldCents: number; releasedCents: number; returnedCents: number } {
  const done = (type: PaymentType) =>
    events
      .filter((event) => event.type === type && event.status === 'completed')
      .reduce((total, event) => total + event.amountCents, 0);
  const client = role === 'client';

  return {
    heldCents: activeHolds.reduce((total, hold) => total + (client ? hold.totalCents : hold.amountCents), 0),
    releasedCents: done('payout'),
    returnedCents: client ? done('void') : 0,
  };
}

function cell(value: string): string {
  // A leading =, +, - or @ would be run as a formula by a spreadsheet.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function ledgerCsv(rows: LedgerRow[]): string {
  const amount = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
  const lines = rows.map((row) =>
    [row.at.toISOString().slice(0, 10), row.project, row.milestone, row.label, amount(row.amountCents), row.reference]
      .map(cell)
      .join(','),
  );
  return ['Date,Project,Milestone,Event,Amount (CAD),PayPal reference', ...lines, ''].join('\r\n');
}

export interface LedgerWeek {
  weekStart: string;
  heldCents: number;
  releasedCents: number;
  returnedCents: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function mondayOf(date: Date): number {
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return day - ((new Date(day).getUTCDay() + 6) % 7) * DAY_MS;
}

/** Completed money movements totalled by week, every week from the first to the last included. */
export function ledgerByWeek(events: LedgerEvent[], role: Role): LedgerWeek[] {
  const done = events.filter((event) => event.status === 'completed');
  if (done.length === 0) return [];
  const client = role === 'client';
  const weeks = new Map<number, LedgerWeek>();
  const first = Math.min(...done.map((event) => mondayOf(event.at)));
  const last = Math.max(...done.map((event) => mondayOf(event.at)));
  for (let week = first; week <= last; week += 7 * DAY_MS) {
    weeks.set(week, { weekStart: new Date(week).toISOString().slice(0, 10), heldCents: 0, releasedCents: 0, returnedCents: 0 });
  }
  for (const event of done) {
    const week = weeks.get(mondayOf(event.at))!;
    if (event.type === 'hold') week.heldCents += client ? event.amountCents : event.holdAmountCents;
    if (event.type === 'payout') week.releasedCents += event.amountCents;
    if (event.type === 'void' && client) week.returnedCents += event.amountCents;
  }
  return [...weeks.values()];
}
