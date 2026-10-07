import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PendingDocsGrouping from '@/components/loads/PendingDocsGrouping';

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  rows: [] as Row[], failFiscal: false, gate: null as Promise<void> | null,
  queries: [] as URL[], rpc: [] as Row[], unconfirmed: false, onCreated: vi.fn(),
}));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: 'tenant' } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'actor' } }) }));
vi.mock('@/hooks/useVehicles', () => ({ useVehicles: () => ({ data: [
  { id: 'v1', plate: 'AAA', max_pallets: 3, current_driver_id: 'd1' },
  { id: 'v2', plate: 'BBB', max_pallets: 10, current_driver_id: 'd2' },
] }) }));
vi.mock('@/hooks/useDrivers', () => ({ useDrivers: () => ({ data: [
  { id: 'd1', name: 'Driver 1' }, { id: 'd2', name: 'Driver 2' },
] }) }));
vi.mock('@/hooks/useOperationalRoutes', () => ({ useOperationalRoutes: () => ({ data: [
  { id: 'brasilia', name: 'Brasilia', destinations: [{ name: 'BRASILIA' }] },
  { id: 'pirapora', name: 'Pirapora', destinations: [{ name: 'PIRAPORA' }] },
  { id: 'salinas', name: 'Salinas', destinations: [{ name: 'SALINAS' }] },
] }) }));
vi.mock('@/hooks/useSonnerToast', () => ({ useSonnerToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return { supabase: createClient('https://fixture.invalid', 'fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/fiscal_documents')) {
        state.queries.push(url);
        if (state.gate) await state.gate;
        if (state.failFiscal) return new Response(JSON.stringify({ code: '503', message: 'availability_unavailable' }), { status: 503 });
        let rows = state.rows;
        for (const field of ['tenant_id', 'status', 'document_type']) {
          const expression = url.searchParams.get(field);
          if (expression) rows = rows.filter(row => row[field] === expression.slice(3));
        }
        for (const field of ['load_id', 'deleted_at']) {
          if (url.searchParams.get(field) === 'is.null') rows = rows.filter(row => row[field] == null);
        }
        const fields = (url.searchParams.get('select') || '').split(',').filter(field => /^[a-z_]+$/.test(field));
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? 500);
        return new Response(JSON.stringify(rows.slice(offset, offset + limit).map(row =>
          Object.fromEntries(fields.map(field => [field, row[field] ?? null])))), { status: 200 });
      }
      if (url.pathname.endsWith('/rpc/create_grouped_load_v1')) {
        const { _payload: payload } = JSON.parse(String(init?.body));
        state.rpc.push(payload);
        // A 200 with incompatible confirmation models an uncertain response without
        // disabling or replacing the actual SDK/RPC/outbox implementation.
        if (state.unconfirmed) return new Response(JSON.stringify({ ok: false }), { status: 200 });
        return new Response(JSON.stringify({
          ok: true, load_id: 'load-1', load: { id: 'load-1', load_number: '1031' },
          request_id: payload.request_id, tenant_id: payload.tenant_id,
          document_count: payload.document_ids.length, document_ids: payload.document_ids,
          replayed: state.rpc.length > 1,
        }), { status: 200 });
      }
      throw new Error(`Unexpected fixture transport: ${url.pathname}`);
    } },
  }) };
});
// Native select controls expose the same disabled/onValueChange contract. Dialog
// layout is omitted; this suite verifies query and command transport, not focus.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange, disabled }: {
    children: ReactNode; value: string; onValueChange: (value: string) => void; disabled?: boolean;
  }) => <select value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>{children}</select>,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value }: { value: string }) => <option value={value}>{value}</option>,
  SelectTrigger: () => null, SelectValue: () => null,
}));

const key = ['pending_fiscal_docs', 'tenant'];
const errorText = /Não foi possível atualizar a disponibilidade das notas/;
let client: QueryClient;
let locksDescriptor: PropertyDescriptor | undefined;
beforeEach(() => {
  vi.clearAllMocks(); state.failFiscal = false; state.gate = null;
  state.queries = []; state.rpc = []; state.unconfirmed = false;
  state.rows = ['BRASILIA', 'PIRAPORA', 'SALINAS'].map((city, index) => ({
    id: `note-${index + 1}`, tenant_id: 'tenant', status: 'confirmed', document_type: 'inbound',
    recipient_city: city, recipient_state: 'MG', pallet_count: 1, weight_kg: 10, value: 100,
    created_at: '2026-10-05T12:00:00Z', load_id: null, deleted_at: null,
    current_delivery_attempt_id: null, cte_emitted_at: null, cte_emitted_outbound_id: null, nfse_emitted_at: null,
  }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  localStorage.clear();
  locksDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: async (_key: string, work: () => Promise<unknown>) => work(),
  } });
});
afterEach(() => {
  cleanup(); client.clear(); localStorage.clear();
  if (locksDescriptor) Object.defineProperty(navigator, 'locks', locksDescriptor);
  else Reflect.deleteProperty(navigator, 'locks');
});
function mount() {
  render(<QueryClientProvider client={client}><PendingDocsGrouping open onOpenChange={vi.fn()} onCreated={state.onCreated} /></QueryClientProvider>);
}
async function loaded() {
  mount(); await screen.findByRole('button', { name: 'Criar 3 Carga(s)' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Criar 3 Carga(s)' })).toBeEnabled());
}
function join() {
  fireEvent.click(screen.getByRole('button', { name: 'Juntar outro grupo a Brasilia' }));
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar Pirapora' }));
}
function assertLocked() {
  screen.getAllByRole('checkbox').forEach(control => expect(control).toBeDisabled());
  screen.getAllByRole('combobox').forEach(control => expect(control).toBeDisabled());
  screen.getAllByRole('button', { name: /^Juntar outro grupo/ }).forEach(control => expect(control).toBeDisabled());
  screen.queryAllByRole('button', { name: /^Separar grupos/ }).forEach(control => expect(control).toBeDisabled());
  screen.queryAllByRole('button', { name: /^Adicionar Salinas/ }).forEach(control => expect(control).toBeDisabled());
  expect(screen.getByRole('button', { name: /^Criar \d+ Carga/ })).toBeDisabled();
}
async function failRefresh() {
  state.failFiscal = true;
  await act(async () => { await client.refetchQueries({ queryKey: key, exact: true }); });
  await screen.findByText(errorText);
}

it('locks cached groups after failed background refresh and preserves the plan through a held successful retry', async () => {
  await loaded();
  fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'v2' } });
  fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: '__none__' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Salinas' }));
  join();
  fireEvent.click(screen.getByRole('button', { name: 'Juntar outro grupo a Brasilia - Pirapora' }));
  const cached = client.getQueryData(key);
  await failRefresh();
  expect(client.getQueryData(key)).toEqual(cached);
  expect(client.getQueryState(key)?.status).toBe('error');
  expect(state.queries.length).toBeGreaterThan(2); // actual SDK retry path, Query retry disabled
  assertLocked();
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar Salinas' }));
  fireEvent.click(screen.getByRole('button', { name: 'Separar grupos de Brasilia - Pirapora' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Salinas' }));
  fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'v1' } });
  fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'd1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Criar 1 Carga(s)' }));
  expect(screen.getByRole('checkbox', { name: 'Selecionar Brasilia - Pirapora' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Selecionar Salinas' })).not.toBeChecked();
  expect(screen.getAllByRole('combobox')[0]).toHaveValue('v2');
  expect(screen.getAllByRole('combobox')[1]).toHaveValue('__none__');
  expect(state.rpc).toEqual([]);

  let release!: () => void;
  state.gate = new Promise<void>(resolve => { release = resolve; }); state.failFiscal = false;
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar notas' }));
  await waitFor(() => expect(client.getQueryState(key)?.fetchStatus).toBe('fetching'));
  assertLocked(); expect(screen.getByRole('button', { name: 'Atualizar notas' })).toBeDisabled();
  expect(state.rpc).toEqual([]);
  state.gate = null; await act(async () => { release(); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Criar 1 Carga(s)' })).toBeEnabled());
  expect(screen.queryByText(errorText)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Adicionar Salinas' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Separar grupos de Brasilia - Pirapora' })).toBeEnabled();
  expect(screen.getAllByRole('combobox')[0]).toHaveValue('v2');
  expect(screen.getAllByRole('combobox')[1]).toHaveValue('__none__');
  expect(screen.getByRole('checkbox', { name: 'Selecionar Salinas' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Criar 1 Carga(s)' }));
  await waitFor(() => expect(state.rpc).toHaveLength(1));
  expect(state.rpc[0]).toMatchObject({
    tenant_id: 'tenant', changes: { destination: 'Brasilia - Pirapora', vehicle_id: 'v2', driver_id: null },
    document_ids: ['note-1', 'note-2'], request_id: expect.any(String),
  });
  await waitFor(() => expect(localStorage.length).toBe(0));
}, 30_000);

it('never offers an editable plan before an initial held availability request succeeds', async () => {
  let release!: () => void; state.gate = new Promise<void>(resolve => { release = resolve; });
  mount(); await screen.findByText('Carregando NF-es pendentes...');
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Criar \d+ Carga/ })).not.toBeInTheDocument();
  expect(state.rpc).toEqual([]);
  state.gate = null; await act(async () => { release(); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Criar 3 Carga(s)' })).toBeEnabled());
  expect(screen.getAllByRole('checkbox')).toHaveLength(3); expect(state.rpc).toEqual([]);
});

it('recovers an already initiated UUID and exact payload while cached availability is in error', async () => {
  await loaded(); join();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Salinas' }));
  state.unconfirmed = true;
  fireEvent.click(screen.getByRole('button', { name: 'Criar 1 Carga(s)' }));
  await screen.findByRole('button', { name: 'Recuperar criação' });
  expect(state.rpc).toHaveLength(1);
  const original = structuredClone(state.rpc[0]);
  expect(original.request_id).toMatch(/^[0-9a-f-]{36}$/i);
  const savedKey = 'agvlog:load-creation:v1:tenant:actor:grouped:Brasilia';
  const serialized = localStorage.getItem(savedKey);
  expect(serialized).not.toBeNull();
  await failRefresh(); assertLocked();
  expect(localStorage.getItem(savedKey)).toBe(serialized);
  const recover = screen.getByRole('button', { name: 'Recuperar criação' });
  expect(recover).toBeEnabled();
  state.onCreated.mockClear();
  state.unconfirmed = false; fireEvent.click(recover);
  await waitFor(() => expect(state.rpc).toHaveLength(2));
  expect(state.rpc[1]).toEqual(original);
  await waitFor(() => expect(localStorage.getItem(savedKey)).toBeNull());
  await waitFor(() => expect(state.onCreated).toHaveBeenCalledOnce());
  // Recovery invalidates availability too; let its real SDK retry cycle settle
  // before fixture teardown rather than leaking background requests into a suite.
  await waitFor(() => expect(client.getQueryState(key)?.fetchStatus).toBe('idle'), { timeout: 15_000 });
  expect(client.getQueryState(key)?.status).toBe('error');
}, 30_000);
