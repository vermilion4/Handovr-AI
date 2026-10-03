import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/auth/current-user';
import { Icon } from '@/components/icon';
import { TopNav } from '@/components/top-nav';
import { db } from '@/db/client';
import { listLedger } from '@/db/queries/ledger';
import { ledgerByWeek, ledgerRows, ledgerTotals } from '@/domain/ledger';
import { formatMoney } from '@/domain/money';
import { LedgerChart } from './ledger-chart';
import { LedgerGrid } from './ledger-grid';

export default async function LedgerPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  const ledger = await listLedger(db, user.id);
  const rows = ledgerRows(ledger.events, ledger.role);
  const totals = ledgerTotals(ledger.events, ledger.activeHolds, ledger.role);
  const weeks = ledgerByWeek(ledger.events, ledger.role);
  const client = ledger.role === 'client';

  const figures = [
    { label: client ? 'Held now' : 'Held for you', value: totals.heldCents, tone: 'text-ink' },
    { label: client ? 'Released' : 'Paid to you', value: totals.releasedCents, tone: 'text-paypal' },
    ...(client ? [{ label: 'Holds cancelled', value: totals.returnedCents, tone: 'text-ink' }] : []),
  ];

  return (
    <>
      <TopNav user={user} active="ledger" />
      <main className="mx-auto max-w-[1440px] px-4 pb-16 pt-6 md:px-24 md:pt-8">
        <h1 className="font-display text-2xl font-medium md:text-[28px]">Ledger</h1>
        <p className="mt-2 text-muted">
          {client
            ? 'Every hold, release and cancellation across your projects, as PayPal recorded it.'
            : 'Every hold and payment across your projects, as PayPal recorded it.'}
        </p>

        <dl className="mt-6 grid gap-6 rounded-2xl bg-white p-6 sm:grid-cols-3 md:max-w-[760px] md:p-8">
          {figures.map((figure) => (
            <div key={figure.label}>
              <dt className="text-[13px] text-muted">{figure.label}</dt>
              <dd className={`mt-1 font-display text-[32px] font-medium ${figure.tone}`}>{formatMoney(figure.value)}</dd>
            </div>
          ))}
        </dl>

        {weeks.length > 0 && (
          <section className="mt-6 rounded-2xl bg-white p-5 md:p-8">
            <h2 className="font-semibold">Money by week</h2>
            <div className="mt-4">
              <LedgerChart weeks={weeks} client={client} />
            </div>
          </section>
        )}

        <section className="mt-6 rounded-2xl bg-white p-5 md:p-8">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Payment events</h2>
            {rows.length > 0 && (
              <a href="/ledger/export" className="flex items-center gap-1.5 text-[13px] font-semibold text-paypal">
                <Icon name="download" size={18} />
                Export as CSV
              </a>
            )}
          </div>

          {rows.length === 0 ? (
            <p className="mt-6 max-w-prose text-muted">
              {client
                ? 'Nothing yet. A row appears here when you fund a milestone.'
                : 'Nothing yet. A row appears here when a client funds one of your milestones.'}
            </p>
          ) : (
            <LedgerGrid
              rows={rows.map((row) => ({
                id: row.id,
                date: row.at.toISOString().slice(0, 10),
                project: row.project,
                milestone: row.milestone,
                label: row.label,
                amountCents: row.amountCents,
                reference: row.reference,
                problem: row.problem,
              }))}
            />
          )}
        </section>
      </main>
    </>
  );
}
