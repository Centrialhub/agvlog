import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CteSearch from '@/pages/CteSearch';
import type { CteSearchFilters, CteSearchRow } from '@/hooks/useCteSearch';

const state = vi.hoisted(() => ({ rows: [] as CteSearchRow[], filters: {} as CteSearchFilters, saveBlob: vi.fn() }));
vi.mock('@/hooks/useCteSearch', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useCteSearch')>();
  const { matchesCteSearchFilters } = await import('@/lib/fiscal/cteListFilters');
  return { ...actual, useCteSearch: (filters: CteSearchFilters) => {
    state.filters = filters;
    return { data: state.rows.filter(row => matchesCteSearchFilters(row, filters)), isLoading: false, isFetching: false, refetch: vi.fn() };
  } };
});
vi.mock('@/hooks/useAlertStore', () => ({ useScopedAlerts: () => ({ promptAction: vi.fn(), confirmAction: vi.fn() }) }));
vi.mock('@/hooks/useSonnerToast', () => ({ useSonnerToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/hooks/useIssueCTe', () => ({ useCancelCTe: () => ({}), useResendCte: () => ({}) }));
vi.mock('@/hooks/useDeleteFailedCTe', () => ({ useDeleteFailedCTe: () => ({}) }));
vi.mock('@/hooks/usePollCteStatus', () => ({ usePollCteStatus: () => ({}) }));
vi.mock('@/components/billing/PendingInvoicesBanner', () => ({ PendingInvoicesBanner: () => null }));
vi.mock('@/lib/fiscal/bulkFileMerge', () => ({ runBulkDownload: vi.fn(), summarizeBulkResult: vi.fn() }));
vi.mock('@/lib/fiscal/cteFiles', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/fiscal/cteFiles')>(), saveBlob: state.saveBlob,
}));

const row = (number: string, issuedAt: string | null): CteSearchRow => ({
  id: number, source: 'hub', cte_number: number, cte_series: '1', cte_type: 'normal',
  access_key: null, sefaz_status: 'processed', sefaz_status_reason: null,
  issued_at: issuedAt, created_at: '2026-08-31T12:00:00Z', payer_name: null,
  remitter: 'Remetente teste', recipient: 'Destinatário teste', recipient_city: 'Janauba', recipient_state: 'MG',
  vehicle_plate: null, driver_name: null, invoice_numbers: '12345', freight_value: 100, cargo_value: 1000,
  hub_document_id: null, emission_id: null, pdf_url: null, xml_url: null,
});
beforeEach(() => { state.rows = [row('278', '2026-08-31')]; state.filters = {}; state.saveBlob.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('CT-e issuance dates in the search page', () => {
  it('shows a date-only emission on its original calendar day, not the previous day', () => {
    render(<CteSearch />);
    expect(within(screen.getByRole('row', { name: /278/ })).getByText('31/08/2026')).toBeInTheDocument();
    expect(screen.queryByText('30/08/2026')).not.toBeInTheDocument();
  });

  it('preserves local-time formatting for full timestamps and the fallback for missing dates', () => {
    const timestamp = '2026-09-01T01:30:00Z';
    state.rows = [row('279', timestamp), row('280', null)];
    render(<CteSearch />);
    expect(within(screen.getByRole('row', { name: /279/ })).getByText(new Date(timestamp).toLocaleDateString('pt-BR'))).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /280/ })).getAllByRole('cell')[5]).toHaveTextContent('—');
  });

  it('exports the same emission day to CSV', async () => {
    render(<CteSearch />);
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    const blob = state.saveBlob.mock.calls[0][0] as Blob;
    const csv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(csv).toContain('"31/08/2026"');
    expect(csv).not.toContain('"30/08/2026"');
  });

  it('keeps the row when filtering by its displayed emission day', () => {
    state.rows.push(row('279', '2026-08-30'));
    render(<CteSearch />);
    fireEvent.change(screen.getByLabelText('Emissão — Início'), { target: { value: '2026-08-31' } });
    fireEvent.change(screen.getByLabelText('Emissão — Fim'), { target: { value: '2026-08-31' } });
    expect(screen.getByText('278')).toBeInTheDocument();
    expect(screen.queryByText('279')).not.toBeInTheDocument();
    expect(screen.getByText('31/08/2026')).toBeInTheDocument();
  });

  it.each([
    { label: 'Hoje', day: '2026-08-31' }, { label: '7 dias', day: '2026-08-24' }, { label: '30 dias', day: '2026-08-01' },
  ])('uses the local day for the $label shortcut near midnight', ({ label, day }) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 7, 31, 23, 30));
      render(<CteSearch />);
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(state.filters.issueDateStart).toBe(day);
      expect(screen.getByLabelText('Emissão — Início')).toHaveValue(day);
    });
});
