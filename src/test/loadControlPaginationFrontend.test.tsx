import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoadControl from '@/pages/LoadControl';

const mock = vi.hoisted(() => ({
  tenant: '20000000-0000-4000-8000-000000000001',
  actor: '10000000-0000-4000-8000-000000000001',
  rpc: vi.fn(),
  failInitial: false,
  failSecond: false,
  holdInitial: false,
  releaseInitial: null as null | (() => void),
}));

vi.mock('@/hooks/useTenant', () => ({
  useTenant: () => ({ currentTenant: { id: mock.tenant, name: 'Empresa QA' } }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mock.actor } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mock.rpc } }));
vi.mock('@/hooks/useLoadControl', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useLoadControl')>();
  return {
    ...actual,
    useLoadDocuments: () => ({ data: [] }),
    useUnloadingCharges: () => ({ data: [], isLoading: false }),
    useImportBatches: () => ({ data: [] }),
    useRegisterPayment: () => ({
      isPending: false,
      pending: null,
      recoveryError: null,
      submit: vi.fn(),
      recover: vi.fn(),
    }),
  };
});
vi.mock('@/hooks/useCompanyProfile', () => ({ useCompanyProfile: () => ({ data: null }) }));
vi.mock('@/hooks/useBankReconciliation', () => ({ useBankAccounts: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/hooks/useAlertStore', () => ({ useScopedAlerts: () => ({ confirmAction: vi.fn(async () => true) }) }));
vi.mock('@/hooks/useSonnerToast', () => ({ useSonnerToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

const cursor = (page: number) => ({
  scope: 'scope-load-control',
  snapshot_at: '2026-09-01T20:00:00+00:00',
  created_at: `2026-08-31T${String(23 - page).padStart(2, '0')}:00:00+00:00`,
  id: `cursor-${page}`,
});

const makeRows = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, offset) => {
  const number = from + offset;
  return {
    id: `load-${String(number).padStart(4, '0')}`,
    tenant_id: mock.tenant,
    load_number: `LC-${String(number).padStart(4, '0')}`,
    external_load_number: null,
    load_date: '2026-08-31',
    arrival_date: null,
    gross_cargo_value: 1000,
    freight_amount: 100,
    freight_percent: null,
    total_weight_kg: 10,
    invoice_count: 1,
    cte_count: 1,
    operational_status: 'in_transit',
    billing_status: 'not_invoiced',
    payment_status: 'unpaid',
    expected_payment_date: null,
    payment_date: null,
    received_amount: 0,
    legacy_status_text: null,
    receivable_id: null,
    client_invoice_id: null,
    doccob_export_id: null,
    origin: 'Origem',
    destination: 'Destino',
    status: 'in_transit',
    created_at: '2026-08-31T12:00:00+00:00',
    client_name: 'Origem',
    driver_name: null,
    plate: null,
  };
});

const response = (items: ReturnType<typeof makeRows>, next: ReturnType<typeof cursor> | null) => ({
  version: 1,
  tenant_id: mock.tenant,
  actor_id: mock.actor,
  items,
  total_count: 501,
  summary: {
    paid: 100,
    unpaid: 401,
    overdue: 0,
    billed: 501_000,
    freight: 50_100,
    open: 50_100,
    weight: 5_010,
    nfs: 501,
    ctes: 501,
  },
  next_cursor: next,
});

let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  mock.failInitial = false;
  mock.failSecond = false;
  mock.holdInitial = false;
  mock.releaseInitial = null;
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mock.rpc.mockImplementation((_name: string, args: { _cursor: null | { id: string } }) => {
    const run = async () => {
      if (args._cursor === null && mock.holdInitial) {
        mock.holdInitial = false;
        await new Promise<void>(resolve => { mock.releaseInitial = resolve; });
      }
      if (args._cursor === null && mock.failInitial) {
        mock.failInitial = false;
        return { data: null, error: new Error('falha inicial simulada') };
      }
      if (args._cursor?.id === 'cursor-1' && mock.failSecond) {
        mock.failSecond = false;
        return { data: null, error: new Error('falha intermediária simulada') };
      }
      if (args._cursor === null) return { data: response(makeRows(1, 250), cursor(1)), error: null };
      if (args._cursor.id === 'cursor-1') return { data: response(makeRows(251, 500), cursor(2)), error: null };
      return { data: response(makeRows(501, 501), null), error: null };
    };
    return { abortSignal: run };
  });
});

afterEach(() => {
  mock.releaseInitial?.();
  cleanup();
  client.clear();
});

function Story() {
  return <QueryClientProvider client={client}><LoadControl /></QueryClientProvider>;
}

describe('load-control pagination UI', { timeout: 20_000 }, () => {
  it('keeps an initial read failure closed and retries explicitly', async () => {
    mock.holdInitial = true;
    mock.failInitial = true;
    render(<Story />);
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma carga.')).not.toBeInTheDocument();
    mock.releaseInitial?.();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('falha inicial simulada');
    expect(screen.queryByText('Nenhuma carga.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Exibindo 250 de 501 cargas filtradas.')).toBeInTheDocument();
  });

  it('surfaces an intermediate failure, retries the same cursor and reaches an explicit end after 501 rows', async () => {
    mock.failSecond = true;
    render(<Story />);
    expect(await screen.findByText('Exibindo 250 de 501 cargas filtradas.')).toBeInTheDocument();
    for (const button of screen.getAllByRole('button', { name: 'CSV' })) expect(button).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais cargas' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('falha intermediária simulada');
    expect(screen.getByText('Exibindo 250 de 501 cargas filtradas.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar carregar próxima página' }));
    expect(await screen.findByText('Exibindo 500 de 501 cargas filtradas.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais cargas' }));
    expect(await screen.findByText('Todas as 501 cargas filtradas foram carregadas.')).toBeInTheDocument();
    expect(screen.getByText('Exibindo 501 de 501 cargas filtradas.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carregar mais cargas' })).not.toBeInTheDocument();
    for (const button of screen.getAllByRole('button', { name: 'CSV' })) expect(button).toBeEnabled();
    expect(screen.getAllByText('LC-0001')).toHaveLength(1);
    expect(screen.getAllByText('LC-0501')).toHaveLength(1);

    await waitFor(() => expect(mock.rpc).toHaveBeenCalledTimes(4));
    expect(mock.rpc.mock.calls.map(([, args]) => args._cursor?.id ?? null))
      .toEqual([null, 'cursor-1', 'cursor-1', 'cursor-2']);
  });
});
