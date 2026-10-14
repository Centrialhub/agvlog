import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PendingDocsGrouping from '@/components/loads/PendingDocsGrouping';

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ rows: [] as Row[], requests: [] as URL[], delivered: [] as Row[],
  timezone: 'America/Sao_Paulo', tenant: '10000000-0000-4000-8000-000000000001',
  actor: '20000000-0000-4000-8000-000000000001', uncertain: false, failed: false,
  hold: null as Promise<void> | null, closed: vi.fn() }));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: state.tenant, timezone: state.timezone } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: state.actor } }) }));
vi.mock('@/hooks/useVehicles', () => ({ useVehicles: () => ({ data: [] }) }));
vi.mock('@/hooks/useDrivers', () => ({ useDrivers: () => ({ data: [] }) }));
vi.mock('@/hooks/useOperationalRoutes', () => ({ useOperationalRoutes: () => ({ data: [] }) }));
vi.mock('@/hooks/useSonnerToast', () => ({ useSonnerToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return { supabase: createClient('https://fixture.invalid', 'synthetic-only', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
      const url = new URL(String(input)); state.requests.push(url);
      if (url.pathname.endsWith('/fiscal_documents')) {
        await state.hold;
        if (state.failed) return new Response(JSON.stringify({ code: '503', message: 'Synthetic read unavailable' }), { status: 503 });
        let rows = state.rows;
        for (const field of ['tenant_id', 'document_type', 'status']) {
          const expression = url.searchParams.get(field);
          if (expression) rows = rows.filter(row => row[field] === expression.slice(3));
        }
        for (const field of ['load_id', 'deleted_at']) if (url.searchParams.get(field) === 'is.null') rows = rows.filter(row => row[field] == null);
        const fields = (url.searchParams.get('select') || '').split(',');
        const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 500);
        return new Response(JSON.stringify(rows.slice(offset, offset + limit).map(row => Object.fromEntries(fields.map(field => [field, row[field] ?? null])))), { status: 200 });
      }
      if (url.pathname.endsWith('/rpc/create_grouped_load_v1')) {
        const command = JSON.parse(String(init?.body))._payload; state.delivered.push(command);
        if (state.uncertain) return new Response(JSON.stringify({ ok: false }), { status: 200 });
        return new Response(JSON.stringify({ ok: true, load_id: '60000000-0000-4000-8000-000000000001',
          load: { id: '60000000-0000-4000-8000-000000000001', load_number: 'LOCAL-1' }, request_id: command.request_id,
          tenant_id: command.tenant_id, document_count: command.document_ids.length, document_ids: command.document_ids, replayed: false }), { status: 200 });
      }
      throw Error('Unexpected synthetic request: ' + url.pathname);
    } },
  }) };
});
const id = (n: number) => '50000000-0000-4000-8000-' + String(n).padStart(12, '0');
function note(n: number, imported_at: string | null, extra: Row = {}): Row {
  return { id: id(n), tenant_id: state.tenant, document_type: 'inbound', status: 'confirmed', load_id: null, deleted_at: null,
    invoice_number: String(n), recipient: 'Cliente', recipient_city: 'Cidade A', recipient_state: 'SP',
    pallet_count: n, weight_kg: n * 10, value: n * 100, imported_at, created_at: '2026-09-01T15:00:00Z',
    issue_date: '2026-10-05', current_delivery_attempt_id: null, ...extra };
}
let client: QueryClient;
let locks: PropertyDescriptor | undefined;
beforeEach(() => {
  state.tenant = '10000000-0000-4000-8000-000000000001'; state.actor = '20000000-0000-4000-8000-000000000001';
  state.timezone = 'America/Sao_Paulo'; state.uncertain = false; state.failed = false; state.hold = null;
  state.requests = []; state.delivered = []; state.closed.mockReset(); localStorage.clear();
  state.rows = [note(1, '2026-10-05T02:59:59.999Z'), note(2, '2026-10-05T03:00:00Z'),
    note(3, '2026-10-06T02:59:59.999Z'), note(4, '2026-10-06T03:00:00Z'),
    note(5, null, { created_at: '2026-10-05T15:00:00Z' }), note(6, 'invalid'),
    note(7, '2026-10-05T15:00:00Z', { load_id: 'linked' }), note(8, '2026-10-05T15:00:00Z', { tenant_id: 'other' }),
    note(9, '2026-10-05T15:00:00Z', { current_delivery_attempt_id: 'attempt', cte_emitted_at: '2026-10-04T12:00:00Z' })];
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false }, mutations: { retry: false } } });
  locks = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_key: string, work: () => Promise<unknown>) => work() } });
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-05T15:00:00Z'));
});
afterEach(() => { cleanup(); client.clear(); localStorage.clear(); vi.useRealTimers();
  if (locks) Object.defineProperty(navigator, 'locks', locks); else Reflect.deleteProperty(navigator, 'locks'); });
function content() { return <QueryClientProvider client={client}><PendingDocsGrouping open onOpenChange={state.closed} onCreated={() => undefined} /></QueryClientProvider>; }
async function show() { const view = render(content()); await waitFor(() => expect(screen.getByRole('button', { name: 'Criar 1 Carga(s)' })).toBeEnabled()); return view; }
function dates(from: string, to: string) {
  fireEvent.change(screen.getByLabelText('Importação de'), { target: { value: from } });
  fireEvent.change(screen.getByLabelText('Importação até'), { target: { value: to } });
}
async function create() { fireEvent.click(screen.getByRole('button', { name: 'Criar 1 Carga(s)' })); await waitFor(() => expect(state.delivered).toHaveLength(1)); return state.delivered[0]; }
describe('Agrupar NF-es by import date with real query SDK and creation outbox', () => {
  it('keeps the unrestricted default and fetches imported_at with tenant/availability constraints', async () => {
    await show(); expect(screen.getByText('6 NF-es pendentes')).toBeVisible();
    expect(state.requests[0].searchParams.get('select')).toContain('imported_at');
    expect((await create()).document_ids).toEqual([1, 2, 3, 4, 5, 6].map(id));
  });
  it('uses the full São Paulo civil day, import time and legacy fallback in totals and payload', async () => {
    await show(); dates('2026-10-05', '2026-10-05');
    expect(screen.getByText('3 NF-es pendentes')).toBeVisible(); expect(screen.getByText('10 paletes')).toBeVisible();
    expect(screen.getByText('100 kg')).toBeVisible(); expect(screen.getByText('R$ 1.000')).toBeVisible();
    expect((await create()).document_ids).toEqual([2, 3, 5].map(id));
  });
  it('uses the selected company timezone at UTC midnight', async () => {
    state.timezone = 'UTC'; await show(); dates('2026-10-05', '2026-10-05');
    expect((await create()).document_ids).toEqual([1, 2, 5].map(id));
  });
  it.each([['2026-10-06', '', [4]], ['', '2026-10-04', [1]]])('supports one-sided period %s %s', async (from, to, expected) => {
    await show(); dates(String(from), String(to)); expect((await create()).document_ids).toEqual((expected as number[]).map(id));
  });
  it('keeps controls editable for empty/invalid ranges and restores all notes on clear', async () => {
    await show(); dates('2026-10-07', '2026-10-06');
    expect(screen.getByRole('alert')).toHaveTextContent('data inicial'); expect(screen.queryByRole('button', { name: /Criar \d/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Importação de')).toBeEnabled(); dates('2026-10-07', '2026-10-07');
    expect(screen.getByText('Nenhuma NF-e pendente no período de importação selecionado.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar datas' })); expect(screen.getByText('6 NF-es pendentes')).toBeVisible();
    expect(state.delivered).toEqual([]);
  });
  it('sets today in the company timezone and leaves existing issuance without previous attempt eligible', async () => {
    state.rows = [note(1, '2026-10-05T15:00:00Z', { cte_emitted_at: '2026-10-04T12:00:00Z' })];
    await show(); fireEvent.click(screen.getByRole('button', { name: 'Importados hoje' }));
    expect(screen.getByLabelText('Importação de')).toHaveValue('2026-10-05'); expect((await create()).document_ids).toEqual([id(1)]);
  });
  it('discards combined group and explicit deselection when the date selection changes', async () => {
    state.rows = [note(1, '2026-10-05T15:00:00Z'), note(2, '2026-10-06T15:00:00Z', { recipient_city: 'Cidade B' })];
    render(content()); await waitFor(() => expect(screen.getByRole('button', { name: 'Criar 2 Carga(s)' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Juntar outro grupo a SP - Cidade A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar SP - Cidade B' }));
    expect(screen.getByRole('button', { name: 'Separar grupos de SP - Cidade A - Cidade B' })).toBeVisible();
    dates('2026-10-05', '2026-10-05'); expect(screen.queryByRole('button', { name: /Separar grupos/ })).not.toBeInTheDocument();
    expect((await create()).document_ids).toEqual([id(1)]);
  });
  it('preserves dates on refetch and blocks mutation during availability revalidation/error', async () => {
    await show(); dates('2026-10-05', '2026-10-05'); let release!: () => void;
    state.hold = new Promise<void>(resolve => { release = resolve; });
    let pending!: Promise<void>; act(() => { pending = client.refetchQueries({ queryKey: ['pending_fiscal_docs', state.tenant] }); });
    await waitFor(() => expect(screen.getByLabelText('Importação de')).toBeDisabled());
    state.failed = true; release(); await act(async () => { await pending; });
    expect(screen.getByLabelText('Importação de')).toHaveValue('2026-10-05'); expect(screen.getByRole('button', { name: 'Criar 1 Carga(s)' })).toBeDisabled();
    await screen.findByRole('alert');
    state.failed = false; state.hold = null; fireEvent.click(screen.getByRole('button', { name: 'Atualizar notas' }));
    await waitFor(() => expect(screen.getByLabelText('Importação de')).toBeEnabled()); expect(screen.getByText('3 NF-es pendentes')).toBeVisible();
  });
  it('locks dates on uncertain creation and recovers the identical filtered UUID/payload', async () => {
    await show(); dates('2026-10-05', '2026-10-05'); state.uncertain = true; await create();
    await screen.findByRole('button', { name: 'Recuperar criação' }); expect(screen.getByLabelText('Importação de')).toBeDisabled();
    const original = structuredClone(state.delivered[0]); state.uncertain = false;
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar criação' })); await waitFor(() => expect(state.delivered).toHaveLength(2));
    expect(state.delivered[1]).toEqual(original); expect(original.document_ids).toEqual([2, 3, 5].map(id));
  });
  it('clears the date range for an actual company change', async () => {
    const view = await show(); dates('2026-10-05', '2026-10-05'); state.tenant = '10000000-0000-4000-8000-000000000002';
    state.rows = [note(1, '2026-10-06T15:00:00Z')]; view.rerender(content());
    await waitFor(() => expect(screen.getByLabelText('Importação de')).toHaveValue(''));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Criar 1 Carga(s)' })).toBeEnabled());
    expect((await create()).tenant_id).toBe(state.tenant);
  });
});
