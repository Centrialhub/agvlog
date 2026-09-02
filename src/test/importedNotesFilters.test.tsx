import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useImportedNotes, type ImportedNoteFilters } from '@/hooks/useImportedNotesSummary';
import ImportedNotesSummary from '@/pages/ImportedNotesSummary';

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ rows: {} as Record<string, Row[]>, requests: [] as URL[], failTable: '' }));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: 'tenant' } }) }));
vi.mock('@/hooks/useClients', () => ({ useClients: () => ({ data: [] }) }));
vi.mock('@/hooks/useCompanyProfile', () => ({ useCompanyProfile: () => ({ data: null }) }));
vi.mock('@/hooks/useAlertStore', () => ({ useScopedAlerts: () => ({ confirmAction: vi.fn() }) }));
vi.mock('@/hooks/useSonnerToast', () => ({ useSonnerToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/importedNotesSummaryPdf', () => ({ downloadImportedNotesSummaryPdf: vi.fn() }));
vi.mock('@/lib/importedNotesXlsx', () => ({ downloadImportedNotesXlsx: vi.fn() }));
vi.mock('@/integrations/supabase/client', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  function splitTerms(value: string): string[] {
    let depth = 0, start = 0;
    const terms: string[] = [];
    for (let i = 0; i < value.length; i++) {
      if (value[i] === '(') depth++;
      if (value[i] === ')') depth--;
      if (value[i] === ',' && depth === 0) { terms.push(value.slice(start, i)); start = i + 1; }
    }
    return [...terms, value.slice(start)];
  }
  function matches(row: Row, term: string): boolean {
    if (term.startsWith('and(')) return splitTerms(term.slice(4, -1)).every(part => matches(row, part));
    if (term.startsWith('or(')) return splitTerms(term.slice(3, -1)).some(part => matches(row, part));
    const [, field, operator, expected] = term.match(/^([^.]+)\.([^.]+)\.(.*)$/)!;
    const actual = row[field];
    if (operator === 'is') return actual == null;
    if (actual == null) return false;
    if (operator === 'eq') return String(actual) === expected;
    if (operator === 'ilike') return String(actual).toLowerCase().includes(expected.slice(1, -1).toLowerCase());
    if (operator === 'ov') return (actual as string[]).some(id => expected.slice(1, -1).split(',').includes(id));
    if (operator === 'in') return expected.slice(1, -1).split(',').includes(String(actual));
    const left = new Date(String(actual)).getTime(), right = new Date(expected).getTime();
    if (operator === 'gte') return left >= right;
    if (operator === 'lte') return left <= right;
    if (operator === 'lt') return left < right;
    throw new Error('Unhandled fixture filter: ' + term);
  }
  const fetchFixture: typeof fetch = async input => {
    const url = new URL(String(input)); state.requests.push(url);
    const table = url.pathname.split('/').pop()!;
    if (state.failTable === table) return new Response(JSON.stringify({ message: 'Consulta indisponível' }), { status: 400 });
    let rows = state.rows[table] || [];
    for (const [field, expression] of url.searchParams) {
      if (['select', 'order', 'limit'].includes(field)) continue;
      rows = rows.filter(row => matches(row, field === 'or' ? `or${expression}` : `${field}.${expression}`));
    }
    return new Response(JSON.stringify(rows), { status: 200 });
  };
  return { supabase: createClient('https://fixture.invalid', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchFixture },
  }) };
});

let client: QueryClient;
function Wrapper({ children }: PropsWithChildren) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; }
const note = (id: string, overrides: Row = {}): Row => ({
  id, tenant_id: 'tenant', document_type: 'inbound', deleted_at: null,
  invoice_number: '12345', remitter: 'ACME', client_id: 'client', supplier_id: 'supplier',
  origin_city: 'Montes Claros', recipient_city: 'Janauba', issue_date: '2026-08-21',
  control_lot: 'LOTE-1', dynamic_lot: 'DIN-1', imported_at: null,
  created_at: new Date('2026-08-31T12:00:00').toISOString(), ...overrides,
});
beforeEach(() => {
  state.rows = { fiscal_documents: [note('legacy')], cte_documents: [], nfse_documents: [] };
  state.requests = []; state.failTable = '';
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); client.clear(); });

async function findNotes(filters: ImportedNoteFilters) {
  const { result } = renderHook(() => useImportedNotes(filters), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  return result.current.data?.map(row => row.id);
}

describe('imported notes filters', () => {
  it.each<ImportedNoteFilters>([
    { importFrom: '2026-08-31' }, { importTo: '2026-08-31' },
    { importFrom: '2026-08-31', importTo: '2026-08-31' },
  ])('uses the displayed creation date when imported_at is null: %j', async filters => {
    expect(await findNotes(filters)).toEqual(['legacy']);
  });

  it.each<ImportedNoteFilters>([
    { invoiceNumber: '12345' }, { remitter: 'acme' }, { clientId: 'client' }, { supplierId: 'supplier' },
    { originCity: 'montes' }, { destinationCity: 'janauba' }, { controlLot: 'LOTE' }, { dynamicLot: 'DIN' },
    { issueFrom: '2026-08-21', issueTo: '2026-08-21' }, { status: 'not_processed' },
  ])('combines an import period with another filter: %j', async filters => {
    state.rows.fiscal_documents.push(note('outside', { created_at: '2026-08-01T12:00:00Z' }));
    expect(await findNotes({ ...filters, importFrom: '2026-08-31', importTo: '2026-08-31' })).toEqual(['legacy']);
  });

  it('uses imported_at when present, without falling back to a conflicting creation date', async () => {
    state.rows.fiscal_documents = [
      note('reimported', { created_at: '2026-08-01T12:00:00Z', imported_at: new Date('2026-08-31T12:00:00').toISOString() }),
      note('older-import', { imported_at: '2026-08-01T12:00:00Z' }),
    ];
    expect(await findNotes({ importFrom: '2026-08-31', importTo: '2026-08-31' })).toEqual(['reimported']);
  });

  it('includes the whole local day, including fractional seconds, but excludes adjacent days', async () => {
    state.rows.fiscal_documents = ['2026-08-30T23:59:59.999', '2026-08-31T00:00:00', '2026-08-31T23:59:59.999', '2026-09-01T00:00:00']
      .flatMap((date, i) => [note(`legacy-${i}`, { created_at: new Date(date).toISOString() }),
        note(`imported-${i}`, { imported_at: new Date(date).toISOString() })]);
    expect(await findNotes({ importFrom: '2026-08-31', importTo: '2026-08-31' }))
      .toEqual(['legacy-1', 'imported-1', 'legacy-2', 'imported-2']);
  });

  it('trims text filters and ignores whitespace-only fields', async () => {
    expect(await findNotes({ invoiceNumber: ' 12345 ', remitter: '  ', destinationCity: ' janauba ' })).toEqual(['legacy']);
  });

  it('keeps tenant, inbound, and soft-delete restrictions when adding the fallback', async () => {
    state.rows.fiscal_documents.push(note('foreign', { tenant_id: 'other' }), note('outbound', { document_type: 'outbound' }),
      note('deleted', { deleted_at: '2026-08-31T13:00:00Z' }));
    expect(await findNotes({ importFrom: '2026-08-31', importTo: '2026-08-31' })).toEqual(['legacy']);
  });

  it('distinguishes query errors from an empty result', async () => {
    state.failTable = 'fiscal_documents';
    const { result } = renderHook(() => useImportedNotes({}), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ message: 'Consulta indisponível' });
  });

  it('rejects an inverted import period instead of displaying zero notes', async () => {
    const { result } = renderHook(() => useImportedNotes({ importFrom: '2026-09-01', importTo: '2026-08-31' }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain('data inicial');
    expect(state.requests).toHaveLength(0);
  });
});

describe('imported notes summary page', () => {
  function renderPage() { return render(<Wrapper><MemoryRouter><ImportedNotesSummary /></MemoryRouter></Wrapper>); }

  it('searches by date and invoice, then clears the filters', async () => {
    state.rows.fiscal_documents.push(note('other', { invoice_number: '67890', created_at: '2026-08-01T12:00:00Z' }));
    renderPage();
    await screen.findByText('12345');
    expect(screen.getByText('67890')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Importação de'), { target: { value: '2026-08-31' } });
    fireEvent.change(screen.getByLabelText('Importação até'), { target: { value: '2026-08-31' } });
    fireEvent.change(screen.getByLabelText('Nº Nota'), { target: { value: ' 12345 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(screen.queryByText('67890')).not.toBeInTheDocument());
    await screen.findByText('12345');
    expect(screen.queryByText('Nenhuma nota encontrada.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await screen.findByText('67890');
    expect(screen.getByLabelText('Importação de')).toHaveValue('');
    expect(screen.getByLabelText('Nº Nota')).toHaveValue('');
  });

  it('shows an actionable query error, not an empty state, and allows retrying', async () => {
    state.failTable = 'fiscal_documents';
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível consultar as notas. Consulta indisponível');
    expect(screen.queryByText('Nenhuma nota encontrada.')).not.toBeInTheDocument();
    expect(screen.getByText('Notas').parentElement).toHaveTextContent('—');
    expect(screen.getByRole('button', { name: 'Exportar CSV' })).toBeDisabled();
    state.failTable = '';
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByText('12345');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('still shows the empty state when the query succeeds with no matching notes', async () => {
    state.rows.fiscal_documents = [];
    renderPage();
    await screen.findByText('Nenhuma nota encontrada.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
