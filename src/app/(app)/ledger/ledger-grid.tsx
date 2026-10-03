'use client';

import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { formatMoney } from '@/domain/money';

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  fontFamily: 'inherit',
  fontSize: 14,
  headerFontWeight: 400,
  headerTextColor: 'var(--color-muted)',
  borderColor: 'var(--color-line)',
  accentColor: 'var(--color-paypal)',
  wrapperBorder: false,
  headerBackgroundColor: 'transparent',
  backgroundColor: 'transparent',
});

export interface GridRow {
  id: string;
  date: string;
  project: string;
  milestone: string;
  label: string;
  amountCents: number;
  reference: string;
  problem: boolean;
}

const columns: ColDef<GridRow>[] = [
  { field: 'date', headerName: 'Date', width: 130, sort: 'desc' },
  { field: 'project', headerName: 'Project', flex: 1, minWidth: 160, filter: true },
  { field: 'milestone', headerName: 'Milestone', flex: 1, minWidth: 140, filter: true },
  { field: 'label', headerName: 'Event', flex: 1.4, minWidth: 220, filter: true, cellClass: (params) => (params.data?.problem ? 'text-fail' : '') },
  { field: 'amountCents', headerName: 'Amount', width: 130, type: 'rightAligned', valueFormatter: (params) => formatMoney(params.value ?? 0) },
  { field: 'reference', headerName: 'PayPal reference', flex: 1, minWidth: 160 },
];

export function LedgerGrid({ rows }: Readonly<{ rows: GridRow[] }>) {
  return (
    <div className="mt-4 h-[520px] min-w-0">
      <AgGridReact<GridRow> theme={theme} rowData={rows} columnDefs={columns} getRowId={(params) => params.data.id} pagination paginationPageSize={20} />
    </div>
  );
}
