import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NewLoadDialog from '@/components/loads/NewLoadDialog';
import { matchesNewLoadImportDate, newLoadImportDateRange } from '@/lib/loads/newLoadImportDateFilters';

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  rows: [] as Row[], requests: [] as URL[], timezone: 'America/Sao_Paulo',
  preference: null as Row | null, savePreference: vi.fn(), submit: vi.fn(),
}));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: 'tenant', timezone: state.timezone } }) }));
vi.mock('@/hooks/useClients', () => ({ useClients: () => ({ data: [] }) }));
vi.mock('@/hooks/useUserUiPreference', () => ({ useUserUiPreference: (_key: string, defaultValue: unknown) => ({
  preference: state.preference ?? defaultValue, isLoaded: true, savePreference: state.savePreference,
}) }));
vi.mock('@/hooks/useLoadCreation', () => ({ useLoadCreation: () => ({
  submit: state.submit, pending: [], error: '', isPending: false,
}) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return { supabase: createClient('https://fixture.invalid', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      const url = new URL(String(input));
      state.requests.push(url);
      // The native candidate has both fiscal-to-load FKs; an unqualified embed
      // must fail here too instead of being silently accepted by this fixture.
      if (url.pathname.endsWith('/fiscal_documents') && /\bloads\(/.test(url.searchParams.get('select') ?? '')) {
        return new Response(JSON.stringify({ code: 'PGRST201', message: 'Ambiguous fiscal-to-load embedding' }), { status: 300 });
      }
      let rows = url.pathname.endsWith('/fiscal_documents') ? state.rows : [];
      for (const field of ['tenant_id', 'document_type']) {
        const expression = url.searchParams.get(field);
        if (expression) rows = rows.filter(row => row[field] === expression.slice(3));
      }
      if (url.searchParams.get('deleted_at') === 'is.null') rows = rows.filter(row => row.deleted_at == null);
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Number(url.searchParams.get('limit') || rows.length);
      return new Response(JSON.stringify(rows.slice(offset, offset + limit)), { status: 200 });
    } },
  }) };
});

function note(id: string, overrides: Row = {}): Row {
  return {
    id, tenant_id: 'tenant', document_type: 'inbound', deleted_at: null, invoice_number: id,
    recipient: 'Cliente A', remitter: 'Fornecedor', recipient_neighborhood: 'Centro',
    imported_at: '2026-10-05T15:00:00Z', created_at: '2026-09-01T12:00:00Z', issue_date: '2026-08-01',
    status: 'confirmed', load_id: null, clients: null, loads: null, ...overrides,
  };
}

let client: QueryClient;
beforeEach(() => {
  state.rows = [note('101'), note('102', { imported_at: null, created_at: '2026-10-05T03:00:00Z' }),
    note('103', { imported_at: '2026-10-05T02:59:59.999Z', created_at: '2026-10-05T15:00:00Z', issue_date: '2026-10-05' }),
    note('104', { imported_at: '2026-10-06T03:00:00Z' }), note('105', { load_id: 'load', loads: { id: 'load', load_number: '999' } }),
    note('foreign', { tenant_id: 'other' }), note('deleted', { deleted_at: '2026-10-05T16:00:00Z' })];
  state.requests = []; state.timezone = 'America/Sao_Paulo'; state.preference = null;
  state.submit.mockResolvedValue({ load: { load_number: '123' }, document_count: 2 });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-05T15:00:00Z'));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  window.sessionStorage.clear();
});
afterEach(() => { cleanup(); client.clear(); vi.useRealTimers(); vi.clearAllMocks(); });

async function show() {
  render(<QueryClientProvider client={client}><MemoryRouter><NewLoadDialog vehicles={[]} drivers={[]} onCreated={vi.fn()} /></MemoryRouter></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Nova Carga' }));
  await waitFor(() => expect(client.getQueryData(['new_load_available_fiscal_docs', 'tenant'])).toEqual(expect.arrayContaining([expect.objectContaining({ id: '101' })])));
  await screen.findByRole('button', { name: /^NF 101/ });
}

const selection = (id: string) => screen.queryByRole('button', { name: new RegExp(`^NF ${id}\\b`) });
const setDates = (from: string, to: string) => {
  fireEvent.change(screen.getByLabelText('Importação de'), { target: { value: from } });
  fireEvent.change(screen.getByLabelText('Importação até'), { target: { value: to } });
};

describe('new load import date rules', () => {
  it('includes the entire tenant day with an exclusive next-day boundary', () => {
    const range = newLoadImportDateRange('2026-10-05', '2026-10-05');
    expect(['2026-10-05T02:59:59.999Z', '2026-10-05T03:00:00Z', '2026-10-06T02:59:59.999Z', '2026-10-06T03:00:00Z']
      .map(imported_at => matchesNewLoadImportDate({ imported_at, created_at: '2026-01-01' }, range)))
      .toEqual([false, true, true, false]);
  });
  it('prioritizes import time and falls back to creation only when import time is absent', () => {
    const range = newLoadImportDateRange('2026-10-05', '2026-10-05');
    expect(matchesNewLoadImportDate({ imported_at: '2026-10-04T15:00:00Z', created_at: '2026-10-05T15:00:00Z' }, range)).toBe(false);
    expect(matchesNewLoadImportDate({ imported_at: null, created_at: '2026-10-05T15:00:00Z' }, range)).toBe(true);
    expect(matchesNewLoadImportDate({ imported_at: 'invalid', created_at: '2026-10-05T15:00:00Z' }, range)).toBe(false);
  });
  it('supports either boundary alone and an unrestricted period', () => {
    const doc = { created_at: '2026-10-05T15:00:00Z' };
    expect(matchesNewLoadImportDate(doc, newLoadImportDateRange('2026-10-05', ''))).toBe(true);
    expect(matchesNewLoadImportDate(doc, newLoadImportDateRange('', '2026-10-04'))).toBe(false);
    expect(matchesNewLoadImportDate({ created_at: 'invalid' }, newLoadImportDateRange('', ''))).toBe(true);
  });
  it('uses the tenant timezone and accounts for a daylight saving change', () => {
    const range = newLoadImportDateRange('2026-11-01', '2026-11-01', 'America/New_York');
    expect(range.from).toBe(Date.parse('2026-11-01T04:00:00Z'));
    expect(range.toExclusive).toBe(Date.parse('2026-11-02T05:00:00Z'));
  });
  it('rejects reversed and invalid periods', () => {
    expect(newLoadImportDateRange('2026-10-06', '2026-10-05').error).toContain('data inicial');
    expect(newLoadImportDateRange('2026-02-30', '').error).toContain('válida');
  });
});

describe('new load XML import filters', () => {
  it('selects and submits only notes imported today, independently of invoice issue date', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Importados hoje' }));
    expect(screen.getByLabelText('Importação de')).toHaveValue('2026-10-05');
    expect(selection('101')).toBeVisible(); expect(selection('102')).toBeVisible();
    expect(selection('103')).not.toBeInTheDocument(); expect(selection('104')).not.toBeInTheDocument();
    expect(selection('foreign')).not.toBeInTheDocument(); expect(selection('deleted')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /NF 105 já vinculada/ })).toBeDisabled();
    const request = state.requests.find(url => url.pathname.endsWith('/fiscal_documents'))!;
    expect(request.searchParams.get('select')).toContain('imported_at');
    expect(request.searchParams.get('select')).toContain('loads!fiscal_documents_load_id_fkey(id,load_number)');
    expect(request.searchParams.get('tenant_id')).toBe('eq.tenant');
    expect(request.searchParams.get('document_type')).toBe('eq.inbound');
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar todos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));
    await waitFor(() => expect(state.submit).toHaveBeenCalledWith('manual', expect.objectContaining({ selected_document_ids: ['101', '102'] })));
  });
  it('combines date and text filters and clears them', async () => {
    await show(); setDates('2026-10-05', '2026-10-05');
    fireEvent.change(screen.getByPlaceholderText('Nº NF'), { target: { value: '102' } });
    await waitFor(() => expect(selection('101')).not.toBeInTheDocument());
    expect(selection('102')).toBeVisible(); expect(selection('103')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await waitFor(() => expect(selection('103')).toBeVisible());
    expect(screen.getByLabelText('Importação de')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Importados hoje' })).toHaveAttribute('aria-pressed', 'false');
  });
  it('keeps previous selections visible in the summary until explicitly cleared', async () => {
    await show(); fireEvent.click(selection('103')!);
    fireEvent.click(screen.getByRole('button', { name: 'Importados hoje' }));
    expect(selection('103')).not.toBeInTheDocument();
    expect(screen.getByText(/Seleções mantidas: 1 NF/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Desmarcar todos' }));
    expect(screen.queryByText(/Seleções mantidas:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar todos' }));
    expect(screen.getByText(/Seleções mantidas: 2 NF/)).toBeVisible();
  });
  it('applies the same date period to recent notes and displays import time', async () => {
    await show(); fireEvent.click(screen.getByRole('button', { name: 'Importados hoje' }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir notas recentes' }));
    expect(selection('101')).toBeVisible(); expect(selection('103')).not.toBeInTheDocument();
    expect(selection('101')).toHaveTextContent('Importado em 05/10/2026 12:00');
  });
  it('shows a validation error for an inverted period and prevents filtered selection', async () => {
    await show(); setDates('2026-10-06', '2026-10-05');
    expect(screen.getByRole('alert')).toHaveTextContent('data inicial de importação');
    expect(screen.getByRole('button', { name: 'Selecionar todos' })).toBeDisabled();
    expect(screen.queryByText('Nenhuma nota encontrada para esses filtros')).not.toBeInTheDocument();
  });
  it('restores legacy preferences and persists the new date fields', async () => {
    state.preference = { filters: { invoice: '', client: '', neighborhood: '' }, sort: 'recent' };
    await show(); expect(screen.getByLabelText('Importação de')).toHaveValue('');
    setDates('2026-10-04', '2026-10-05');
    await waitFor(() => expect(state.savePreference).toHaveBeenCalledWith(expect.objectContaining({
      filters: expect.objectContaining({ importFrom: '2026-10-04', importTo: '2026-10-05', importToday: false }),
    })));
  });
  it('resolves a restored today shortcut in the current tenant day and refreshes at midnight', async () => {
    state.timezone = 'America/Manaus';
    vi.setSystemTime(new Date('2026-10-06T03:30:00Z'));
    state.preference = { filters: { invoice: '', client: '', neighborhood: '', importToday: true }, sort: 'recent' };
    await show(); expect(screen.getByLabelText('Importação de')).toHaveValue('2026-10-05');
    await act(async () => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
      // Re-mount to attach the day refresh to the controlled interval clock.
      cleanup();
    });
    render(<QueryClientProvider client={client}><MemoryRouter><NewLoadDialog vehicles={[]} drivers={[]} onCreated={vi.fn()} /></MemoryRouter></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Nova Carga' }));
    await act(async () => { vi.advanceTimersByTime(31 * 60 * 1000); });
    expect(screen.getByLabelText('Importação de')).toHaveValue('2026-10-06');
  });
  it('filters all fetched pages and selects matches beyond the first visible 25 notes', async () => {
    state.rows = Array.from({ length: 505 }, (_, i) => note(String(101 + i)));
    await show();
    await waitFor(() => expect(state.requests.filter(url => url.pathname.endsWith('/fiscal_documents'))).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Importados hoje' }));
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar todos' }));
    expect(screen.getByText(/Seleções mantidas: 505 NF/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Importados hoje' }));
    setDates('2026-10-06', '2026-10-06');
    expect(screen.getByRole('button', { name: 'Selecionar todos' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Desmarcar todos' }));
    expect(screen.getByText('0 selecionada(s)')).toBeVisible();
    expect(screen.queryByText(/Seleções mantidas:/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desmarcar todos' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));
    await waitFor(() => expect(state.submit).toHaveBeenCalledWith('manual', expect.objectContaining({ selected_document_ids: [], manual_document: undefined })));
  });
  it('keeps bulk controls visible and does not duplicate selections when selecting all repeatedly', async () => {
    await show();
    expect(screen.getByRole('button', { name: 'Desmarcar todos' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Importados hoje' }));
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar todos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar todos' }));
    expect(screen.getByText('2 selecionada(s)')).toBeVisible();
    expect(screen.getByRole('button', { name: /NF 105 já vinculada/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Desmarcar todos' }));
    expect(screen.getByLabelText('Importação de')).toHaveValue('2026-10-05');
    expect(screen.getByRole('button', { name: 'Importados hoje' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('0 selecionada(s)')).toBeVisible();
  });
});

it('loads 505 notes with concurrent load FKs and submits only the 503 eligible notes', async () => {
  const eligible = Array.from({ length: 503 }, (_, index) => note(String(101 + index)));
  // Fiscal emission alone permits first assignment; previous operation plus
  // emission requires fiscal review and must stay outside the selected IDs.
  eligible[502] = note('603', { cte_emitted_at: '2026-10-05T14:00:00Z' });
  state.rows = [...eligible,
    note('604', { load_id: 'other-load', loads: { id: 'other-load', load_number: 'OTHER' } }),
    note('605', { cte_emitted_at: '2026-10-05T14:00:00Z', current_delivery_attempt_id: 'previous-attempt' })];
  state.submit.mockResolvedValue({ load: { load_number: '123' }, document_count: 503 });
  await show();
  const requests = state.requests.filter(url => url.pathname.endsWith('/fiscal_documents'));
  expect(requests).toHaveLength(2);
  for (const request of requests) {
    expect(request.searchParams.get('select')).toContain('loads!fiscal_documents_load_id_fkey(id,load_number)');
    expect(request.searchParams.get('tenant_id')).toBe('eq.tenant');
    expect(request.searchParams.get('document_type')).toBe('eq.inbound');
    expect(request.searchParams.get('deleted_at')).toBe('is.null');
  }
  fireEvent.click(screen.getByRole('button', { name: 'Selecionar todos' }));
  fireEvent.click(screen.getByRole('button', { name: 'Criar' }));
  await waitFor(() => expect(state.submit).toHaveBeenCalledTimes(1));
  const payload = state.submit.mock.calls[0][1] as { selected_document_ids: string[] };
  expect(payload.selected_document_ids).toHaveLength(503);
  expect(new Set(payload.selected_document_ids)).toEqual(new Set(eligible.map(row => String(row.id))));
});
