import { getCurrentUser } from '@/auth/current-user';
import { db } from '@/db/client';
import { listLedger } from '@/db/queries/ledger';
import { ledgerCsv, ledgerRows } from '@/domain/ledger';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response('Sign in to export the ledger.', { status: 401 });

  const ledger = await listLedger(db, user.id);
  return new Response(ledgerCsv(ledgerRows(ledger.events, ledger.role)), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="handovr-ledger.csv"',
    },
  });
}
