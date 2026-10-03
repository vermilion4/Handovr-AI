import { describe, expect, it } from 'vitest';
import { ledgerCsv, ledgerRows, ledgerTotals, type LedgerEvent } from './ledger';

const at = (day: number) => new Date(Date.UTC(2026, 9, day, 12));
const event = (over: Partial<LedgerEvent>): LedgerEvent => ({
  id: `e${Math.random()}`,
  at: at(1),
  projectTitle: "Chen's Bakery website",
  milestoneTitle: 'Contact page',
  counterpartName: 'Tomás Rivera',
  type: 'hold',
  status: 'completed',
  amountCents: 61823,
  holdAmountCents: 60000,
  paypalId: 'AUTH-1',
  detail: '',
  ...over,
});

const history = [
  event({ id: 'hold', at: at(1) }),
  event({ id: 'renew', at: at(26), type: 'renew', paypalId: 'AUTH-2' }),
  event({ id: 'capture', at: at(28), type: 'capture', paypalId: 'CAP-1' }),
  event({ id: 'payout', at: new Date(at(28).getTime() + 60_000), type: 'payout', amountCents: 60000, paypalId: 'PB-1' }),
];

describe('ledgerRows', () => {
  it('shows the client every money event, newest first, in plain words', () => {
    const rows = ledgerRows(history, 'client');
    expect(rows.map((row) => [row.label, row.amountCents, row.reference])).toEqual([
      ['Paid out to Tomás', 60000, 'PB-1'],
      ['Payment captured', 61823, 'CAP-1'],
      ['Hold renewed', 61823, 'AUTH-2'],
      ['Hold placed', 61823, 'AUTH-1'],
    ]);
    expect(rows.every((row) => !row.problem)).toBe(true);
  });

  it('shows the freelancer their side: the milestone amount, and no capture', () => {
    const rows = ledgerRows(history.map((e) => ({ ...e, counterpartName: 'Maya Chen' })), 'freelancer');
    expect(rows.map((row) => [row.label, row.amountCents])).toEqual([
      ['Paid to you', 60000],
      ['Hold renewed', 60000],
      ['Hold placed for you', 60000],
    ]);
  });

  it('describes a payout that is on its way, unclaimed, or cancelled', () => {
    const label = (over: Partial<LedgerEvent>, role: 'client' | 'freelancer' = 'client') => ledgerRows([event(over)], role)[0].label;
    expect(label({ type: 'payout', status: 'sent' })).toBe('Payout to Tomás on its way');
    expect(label({ type: 'payout', status: 'sent' }, 'freelancer')).toBe('Payment on its way to you');
    expect(label({ type: 'payout', detail: 'unclaimed' })).toBe('Paid out to Tomás, waiting to be claimed');
    expect(label({ type: 'payout', detail: 'unclaimed' }, 'freelancer')).toBe('Paid to you, waiting for you to claim it in PayPal');
    expect(label({ type: 'void' })).toBe('Hold cancelled, nothing was taken');
  });

  it('marks failures as problems and hides work that has not been sent', () => {
    const rows = ledgerRows(
      [
        event({ type: 'capture', status: 'failed' }),
        event({ type: 'payout', status: 'failed' }),
        event({ type: 'renew', status: 'failed' }),
        event({ type: 'payout', status: 'blocked' }),
        event({ type: 'capture', status: 'pending' }),
        event({ type: 'void', status: 'sending' }),
      ],
      'client',
    );
    expect(rows.map((row) => row.label).sort()).toEqual(['Capture failed', 'Hold could not be renewed', 'Payout failed, trying again']);
    expect(rows.every((row) => row.problem)).toBe(true);
  });
});

describe('ledgerTotals', () => {
  const holds = [{ amountCents: 60000, totalCents: 61823 }, { amountCents: 45000, totalCents: 46376 }];
  const events = [...history, event({ type: 'void', amountCents: 46376 }), event({ type: 'payout', status: 'sent', amountCents: 99999 })];

  it('adds up what the client has held, released and had returned', () => {
    expect(ledgerTotals(events, holds, 'client')).toEqual({ heldCents: 108199, releasedCents: 60000, returnedCents: 46376 });
  });

  it('adds up what is held for and paid to the freelancer', () => {
    expect(ledgerTotals(events, holds, 'freelancer')).toEqual({ heldCents: 105000, releasedCents: 60000, returnedCents: 0 });
  });
});

describe('ledgerCsv', () => {
  it('writes one line per row with a header, amounts as decimals', () => {
    const csv = ledgerCsv(ledgerRows(history.slice(0, 1), 'client'));
    expect(csv).toBe(
      'Date,Project,Milestone,Event,Amount (CAD),PayPal reference\r\n' +
        '2026-10-01,Chen\'s Bakery website,Contact page,Hold placed,618.23,AUTH-1\r\n',
    );
  });

  it('quotes commas and quotes, and defuses cells a spreadsheet would run as a formula', () => {
    const rows = ledgerRows([event({ projectTitle: 'Shop, "phase 2"', milestoneTitle: '=SUM(A1:A9)' })], 'client');
    expect(ledgerCsv(rows).split('\r\n')[1]).toBe('2026-10-01,"Shop, ""phase 2""",\'=SUM(A1:A9),Hold placed,618.23,AUTH-1');
  });
});
