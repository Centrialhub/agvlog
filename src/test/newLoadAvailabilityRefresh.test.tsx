import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import NewLoadDialog from '@/components/loads/NewLoadDialog';

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  rows: [] as Row[], failFiscal: false, gate: null as Promise<void> | null,
  submit: vi.fn(), recover: vi.fn(), pending: false,
}));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: 'tenant', timezone: 'America/Sao_Paulo' } }) }));
vi.mock('@/hooks/useClients', () => ({ useClients: () => ({ data: [] }) }));
vi.mock('@/hooks/useUserUiPreference', () => ({ useUserUiPreference: (_key: string, value: unknown) => ({ preference: value, isLoaded: true, savePreference: vi.fn() }) }));
vi.mock('@/hooks/useLoadCreation', () => ({ useLoadCreation: () => ({
  submit: state.submit, recover: state.recover,
  pending: state.pending ? [{ scope: 'manual', payload: { request_id: 'preserved-request' } }] : [],
  error: '', isPending: false,
}) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return { supabase: createClient('https://fixture.invalid', 'fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      const url = new URL(String(input));
      if (!url.pathname.endsWith('/fiscal_documents')) return new Response('[]', { status: 200 });
      if (state.gate) await state.gate;
      if (state.failFiscal) return new Response(JSON.stringify({ code: '503', message: 'availability_unavailable' }), { status: 503 });
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 500);
      return new Response(JSON.stringify(state.rows.slice(offset, offset + limit)), { status: 200 });
    } },
  }) };
});

const key = ['new_load_available_fiscal_docs', 'tenant'];
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks(); state.failFiscal = false; state.gate = null; state.pending = false;
  state.rows = ['101', '102'].map(id => ({
    id, tenant_id: 'tenant', document_type: 'inbound', deleted_at: null, invoice_number: id,
    recipient: 'Cliente A', remitter: 'Fornecedor', recipient_neighborhood: 'Centro',
    imported_at: '2026-10-05T15:00:00Z', created_at: '2026-10-05T14:00:00Z',
    status: 'confirmed', load_id: null, clients: null, loads: null,
  }));
  state.submit.mockResolvedValue({ load: { load_number: '123' }, document_count: 1 });
  state.recover.mockResolvedValue({ load: { load_number: '123' }, document_count: 1 });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  sessionStorage.clear(); vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-05T15:00:00Z'));
});
afterEach(() => { cleanup(); client.clear(); vi.useRealTimers(); });

function open() {
  render(<QueryClientProvider client={client}><MemoryRouter><NewLoadDialog vehicles={[]} drivers={[]} onCreated={vi.fn()} /></MemoryRouter></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Nova Carga' }));
}
const note = (id: string) => screen.getByRole('button', { name: new RegExp(`^NF ${id}\\b`) });
const selected = (count: number) => screen.getByText(`${count} selecionada(s)`, { exact: true });
async function loaded() {
  open(); await screen.findByRole('button', { name: /^NF 101\b/ });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Selecionar todos' })).toBeEnabled());
}
async function failRefresh() {
  state.failFiscal = true;
  await act(async () => { await client.refetchQueries({ queryKey: key, exact: true }); });
  await screen.findByText(/Não foi possível atualizar a disponibilidade das notas/);
}

it('blocks cached availability after a failed background refresh and unlocks only after success', async () => {
  await loaded(); fireEvent.click(note('101'));
  fireEvent.change(screen.getByPlaceholderText('Nº NF'), { target: { value: '10' } });
  fireEvent.click(screen.getByRole('button', { name: 'Importados hoje' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Selecionar todos' })).toBeEnabled());
  await failRefresh();
  expect(client.getQueryData(key)).toEqual(state.rows); // cached success still exists
  expect(selected(1)).toBeVisible();
  expect(screen.getByPlaceholderText('Nº NF')).toHaveValue('10');
  expect(screen.getByLabelText('Importação de')).toHaveValue('2026-10-05');
  expect(screen.getByRole('button', { name: 'Selecionar todos' })).toBeDisabled();
  expect(note('102')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Confirmar nota' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Criar' })).toBeDisabled();
  fireEvent.click(note('102'));
  fireEvent.click(screen.getByRole('button', { name: 'Selecionar todos' }));
  fireEvent.click(screen.getByRole('button', { name: 'Criar' }));
  expect(selected(1)).toBeVisible(); expect(state.submit).not.toHaveBeenCalled();

  state.failFiscal = false;
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar notas' }));
  await waitFor(() => expect(screen.queryByText(/Não foi possível atualizar a disponibilidade das notas/)).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Selecionar todos' })).toBeEnabled();
  expect(note('102')).toBeEnabled(); expect(selected(1)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Selecionar todos' }));
  expect(selected(2)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Criar' }));
  await waitFor(() => expect(state.submit).toHaveBeenCalledOnce());
  expect(state.submit.mock.calls[0][1].selected_document_ids).toEqual(['101', '102']);
});

it('blocks new choices and creation throughout a held refresh without removing the prior selection', async () => {
  await loaded(); fireEvent.click(note('101'));
  let release!: () => void;
  state.gate = new Promise<void>(resolve => { release = resolve; });
  let refresh!: Promise<void>;
  act(() => { refresh = client.refetchQueries({ queryKey: key, exact: true }); });
  await waitFor(() => expect(client.getQueryState(key)?.fetchStatus).toBe('fetching'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Selecionar todos' })).toBeDisabled());
  expect(note('102')).toBeDisabled(); expect(selected(1)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Criar' })).toBeDisabled();
  expect(state.submit).not.toHaveBeenCalled();
  state.gate = null; release(); await act(async () => { await refresh; });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Selecionar todos' })).toBeEnabled());
  expect(selected(1)).toBeVisible();
});

it('allows explicit deselection after a failed refresh and preserves filters', async () => {
  await loaded(); fireEvent.click(note('101'));
  fireEvent.click(screen.getByRole('button', { name: 'Importados hoje' }));
  await failRefresh();
  expect(screen.getByRole('button', { name: 'Desmarcar todos' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Desmarcar todos' }));
  expect(selected(0)).toBeVisible(); expect(screen.getByLabelText('Importação de')).toHaveValue('2026-10-05');
  expect(screen.getByRole('button', { name: 'Criar' })).toBeDisabled();
  expect(state.submit).not.toHaveBeenCalled();
});

it('also blocks a new selection in the recent-notes dialog after a failed refresh', async () => {
  await loaded(); fireEvent.click(note('101')); await failRefresh();
  fireEvent.click(screen.getByRole('button', { name: 'Abrir notas recentes' }));
  const recent = await screen.findByRole('dialog', { name: 'Notas enviadas recentes' });
  const other = within(recent).getByRole('button', { name: /^NF 102\b/ });
  expect(other).toBeDisabled(); fireEvent.click(other);
  expect(within(recent).getByRole('button', { name: /^NF 101\b/ })).toBeEnabled();
  expect(state.submit).not.toHaveBeenCalled();
});

it('keeps durable recovery available when the notes query fails with no result', async () => {
  state.failFiscal = true; state.pending = true; open();
  await screen.findByText(/Não foi possível atualizar a disponibilidade das notas/,{}, {timeout:15000});
  expect(screen.getByRole('button', { name: 'Selecionar todos' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Criar' })).toBeDisabled();
  const recover = screen.getByRole('button', { name: 'Recuperar criação' });
  expect(recover).toBeEnabled(); fireEvent.click(recover);
  await waitFor(() => expect(state.recover).toHaveBeenCalledWith('manual'));
  expect(state.submit).not.toHaveBeenCalled();
});
