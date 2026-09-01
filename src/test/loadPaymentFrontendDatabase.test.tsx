import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import LoadControl from '@/pages/LoadControl';
import { pendingLoadPaymentCommand } from '@/lib/loadPayments/loadPaymentOutbox';
import {
  applyLoadPayment,
  createLoadPaymentDatabase,
  loadPaymentIds as i,
  seedLoadPayment,
} from './helpers/loadPaymentDatabase';

vi.hoisted(async () => {
  const { Blob, File } = await import('node:buffer');
  vi.stubGlobal('Blob', Blob);
  vi.stubGlobal('File', File);
});

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  tenant: '',
  actor: '',
  lost: false,
  delay: false,
  bankError: false,
  release: null as null | (() => void),
}));

vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: mock.tenant, name: 'Empresa QA' } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mock.actor } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mock.rpc, from: mock.from } }));
vi.mock('@/hooks/useSonnerToast', () => ({ useSonnerToast: () => ({ success: mock.success, error: mock.error }) }));
vi.mock('@/hooks/useAlertStore', () => ({ useScopedAlerts: () => ({ confirmAction: vi.fn(async () => true) }) }));
vi.mock('@/hooks/useCompanyProfile', () => ({ useCompanyProfile: () => ({ data: null }) }));
vi.mock('@/hooks/useBankReconciliation', () => ({
  useBankAccounts: () => mock.bankError
    ? { data: [], isPending: false, isError: true }
    : { data: [{ id: 'cf700000-0000-4000-8000-000000000002', name: 'Banco QA', active: true }], isPending: false, isError: false },
}));
vi.mock('@/hooks/useLoadControl', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useLoadControl')>();
  return {
    ...actual,
    useLoadControlList: () => ({
      data: [{
        id: '70000000-0000-4000-8000-000000000001', tenant_id: '20000000-0000-4000-8000-000000000001',
        load_number: 'QA-LOAD-PAYMENT', external_load_number: null, load_date: '2026-08-30', arrival_date: '2026-08-31',
        gross_cargo_value: 1000, freight_amount: 100, freight_percent: 10, total_weight_kg: 100,
        invoice_count: 1, cte_count: 1, operational_status: 'delivered', billing_status: 'invoiced',
        payment_status: 'unpaid', expected_payment_date: '2026-09-10', payment_date: null, received_amount: 0,
        legacy_status_text: null, receivable_id: 'cf700000-0000-4000-8000-000000000001', status: 'delivered',
      }],
      isLoading: false,
      refetch: vi.fn(),
    }),
    useLoadDocuments: () => ({ data: [] }),
    useUnloadingCharges: () => ({ data: [] }),
    useImportBatches: () => ({ data: [] }),
  };
});

let db: PGlite;
let client: QueryClient;
let transport: Promise<unknown> = Promise.resolve();

beforeAll(async () => { ({ db } = await createLoadPaymentDatabase()); }, 30000);
afterAll(async () => { await db?.close(); vi.unstubAllGlobals(); });
beforeEach(async () => {
  await db.exec('begin');
  await seedLoadPayment(db);
  localStorage.clear();
  vi.clearAllMocks();
  mock.tenant = i.tenant;
  mock.actor = i.operator;
  mock.lost = false;
  mock.delay = false;
  mock.bankError = false;
  mock.release = null;
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_key: string, work: () => Promise<unknown>) => work() } });
  mock.from.mockImplementation(() => { throw new Error('Load payment must not write tables directly'); });
  mock.rpc.mockImplementation((name: string, args: { _payload: unknown }) => {
    let pending: Promise<unknown> | undefined;
    const run = () => {
      if (pending) return pending;
      const work = async () => {
        try {
          if (name !== 'apply_load_payment_command') throw new Error(`Unexpected RPC ${name}`);
          if (mock.delay) {
            mock.delay = false;
            await new Promise<void>(resolve => { mock.release = resolve; });
          }
          await db.query("select set_config('request.jwt.claim.sub',$1,false)", [mock.actor]);
          const data = await applyLoadPayment(db, args._payload);
          if (mock.lost) {
            mock.lost = false;
            return { data: null, error: { message: 'Resposta perdida após confirmação no banco' } };
          }
          return { data, error: null };
        } catch (error) { return { data: null, error }; }
      };
      pending = transport.then(work, work);
      transport = pending;
      return pending;
    };
    return { abortSignal: run, then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => run().then(resolve, reject) };
  });
});
afterEach(async () => {
  mock.release?.();
  cleanup();
  client.clear();
  await transport;
  await db.exec('rollback');
  localStorage.clear();
});

function Story() {
  return <QueryClientProvider client={client}><LoadControl /></QueryClientProvider>;
}

const openDialog = async () => {
  render(<Story />);
  fireEvent.click(screen.getByRole('button', { name: 'Registrar pagamento da carga QA-LOAD-PAYMENT' }));
  await screen.findByRole('dialog');
};

describe('load payment screen backed by the real SQL command', { timeout: 15000 }, () => {
  it('uses only the canonical RPC and closes only after a compatible confirmation', async () => {
    await openDialog();
    expect(screen.getByLabelText('Conta bancária')).toHaveValue(i.bank);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar pagamento' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(mock.rpc.mock.calls[0][0]).toBe('apply_load_payment_command');
    expect(mock.from).not.toHaveBeenCalled();
    expect((await db.query('select count(*)::int count from load_payments')).rows[0]).toEqual({ count: 1 });
    expect(mock.success).toHaveBeenCalledWith('Pagamento registrado');
  });

  it('keeps uncertainty visible and retries the exact request UUID after a lost response', async () => {
    mock.lost = true;
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar pagamento' }));
    await screen.findByText('Resposta perdida após confirmação no banco');
    const request = pendingLoadPaymentCommand(localStorage, i.tenant, i.operator)!.payload.request_id;
    expect(screen.getByRole('button', { name: 'Confirmar pagamento' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar pagamento' }));
    await waitFor(() => expect(mock.success).toHaveBeenCalledWith('Pagamento recuperado e confirmado'));
    expect(mock.rpc.mock.calls.map(([, args]) => args._payload.request_id)).toEqual([request, request]);
    expect((await db.query('select count(*)::int count from load_payments')).rows[0]).toEqual({ count: 1 });
    expect(pendingLoadPaymentCommand(localStorage, i.tenant, i.operator)).toBeNull();
  });

  it('disables duplicate submission while the command is in flight', async () => {
    mock.delay = true;
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar pagamento' }));
    expect(await screen.findByRole('button', { name: 'Registrando…' })).toBeDisabled();
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    mock.release?.();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  });

  it('fails closed when bank accounts cannot be confirmed', async () => {
    mock.bankError = true;
    await openDialog();
    expect(screen.getByRole('alert', { name: '' })).toHaveTextContent('Não foi possível confirmar as contas bancárias');
    expect(screen.getByRole('button', { name: 'Confirmar pagamento' })).toBeDisabled();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
