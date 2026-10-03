import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/auth/current-user';
import { Icon } from '@/components/icon';
import { TopNav } from '@/components/top-nav';
import { db } from '@/db/client';
import { listLedger } from '@/db/queries/ledger';
import { ledgerRows, ledgerTotals } from '@/domain/ledger';
import { formatMoney } from '@/domain/money';

const shortDate = new Intl.DateTimeFormat('en-CA', { day: 'numeric', month: 'short', year: 'numeric' });

export default async function LedgerPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');

  const ledger = await listLedger(db, user.id);
  const rows = ledgerRows(ledger.events, ledger.role);
  const totals = ledgerTotals(ledger.events, ledger.activeHolds, ledger.role);
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
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-line text-xs text-muted">
                  <tr>
                    {['Date', 'Project', 'Milestone', 'Event', 'Amount', 'PayPal reference'].map((heading) => (
                      <th key={heading} scope="col" className="py-3 pr-4 font-normal">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap py-4 pr-4 text-muted">{shortDate.format(row.at)}</td>
                      <td className="py-4 pr-4 font-semibold">{row.project}</td>
                      <td className="py-4 pr-4">{row.milestone}</td>
                      <td className={`py-4 pr-4 ${row.problem ? 'text-fail' : ''}`}>
                        <span className="flex items-center gap-2">
                          <Icon name={row.icon} size={18} />
                          {row.label}
                        </span>
                      </td>
                      <td className="py-4 pr-4 font-display font-medium">{formatMoney(row.amountCents)}</td>
                      <td className="py-4 text-[13px] text-muted">{row.reference}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
