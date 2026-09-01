import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import DriverMonitoring from '@/pages/DriverMonitoring';
import { pendingDriverMonitorCommand } from '@/lib/driverMonitoring/driverMonitorOutbox';
import {
  applyDriverMonitorCommand,
  createDriverMonitorDatabase,
  driverMonitorCreatePayload,
  driverMonitorIds as i,
} from './helpers/driverMonitorCommandDatabase';

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
  row: null as null | Record<string, unknown>,
  lost: false,
  delay: false,
  release: null as null | (() => void),
}));

vi.mock('@/hooks/useTenant', () => ({
  useTenant: () => ({ currentTenant: { id: mock.tenant, name: 'Empresa QA' } }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mock.actor } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mock.rpc, from: mock.from } }));
vi.mock('@/hooks/useSonnerToast', () => ({
  useSonnerToast: () => ({ success: mock.success, error: mock.error }),
}));
vi.mock('@/hooks/useCompanyProfile', () => ({ useCompanyProfile: () => ({ data: null }) }));
vi.mock('@/hooks/useDriverMonitoring', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useDriverMonitoring')>();
  const mutation = () => ({ isPending: false, mutateAsync: vi.fn() });
  return {
    ...actual,
    useDriverMonitorsList: () => ({ data: mock.row ? [mock.row] : [], isLoading: false }),
    useMonitorForecasts: () => ({ data: [] }),
    useMonitorUpdates: () => ({ data: [] }),
    useAddProgressUpdate: mutation,
    useAddForecast: mutation,
    useImportDriverMonitoringWorkbook: mutation,
  };
});

let db: PGlite;
let client: QueryClient;
let transport: Promise<unknown> = Promise.resolve();

beforeAll(async () => { db = await createDriverMonitorDatabase(); }, 30000);
afterAll(async () => { await db?.close(); vi.unstubAllGlobals(); });
beforeEach(async () => {
  await db.exec('begin');
  localStorage.clear();
  vi.clearAllMocks();
  mock.tenant = i.tenant;
  mock.actor = i.operator;
  mock.lost = false;
  mock.delay = false;
  mock.release = null;
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: async (_key: string, work: () => Promise<unknown>) => work() },
  });
  mock.from.mockImplementation(() => {
    throw new Error('Driver monitor create/edit must not write tables directly');
  });

  const seed = driverMonitorCreatePayload({
    changes: {
      ...driverMonitorCreatePayload().changes,
      driver_name_snapshot: 'Motorista existente',
      vehicle_plate_snapshot: 'EXI1A11',
    },
  });
  const result = await applyDriverMonitorCommand(db, seed);
  mock.row = {
    id: result.monitor_id,
    tenant_id: i.tenant,
    monitor_number: result.monitor_number,
    driver_id: null,
    driver_name_snapshot: 'Motorista existente',
    vehicle_id: null,
    vehicle_plate_snapshot: 'EXI1A11',
    load_id: null,
    load_number: null,
    planned_route_text: 'Montes Claros / Janaúba',
    planned_cities: ['Montes Claros', 'Janaúba'],
    started_at: '2026-09-01T12:00:00.000Z',
    expected_return_date: '2026-09-03',
    return_deadline_days: 2,
    actual_returned_at: null,
    total_deliveries: 10,
    completed_deliveries: 0,
    remaining_deliveries: 10,
    progress_percent: 0,
    current_city: null,
    next_city: null,
    remaining_cities: [],
    arrival_forecast_text: null,
    arrival_forecast_at: null,
    status: 'active',
    last_update_at: null,
    notes: 'Monitoramento QA',
    revision: 0,
    updated_at: String(result.updated_at),
  };

  mock.rpc.mockImplementation((name: string, args: { _payload: unknown }) => {
    let pending: Promise<unknown> | undefined;
    const run = () => {
      if (pending) return pending;
      const work = async () => {
        try {
          if (name !== 'apply_driver_monitor_command') throw new Error('Unexpected RPC ' + name);
          if (mock.delay) {
            mock.delay = false;
            await new Promise<void>(resolve => { mock.release = resolve; });
          }
          await db.query("select set_config('request.jwt.claim.sub',$1,false)", [mock.actor]);
          const data = await applyDriverMonitorCommand(db, args._payload);
          if (mock.lost) {
            mock.lost = false;
            return { data: null, error: { message: 'Resposta perdida após confirmação no banco' } };
          }
          return { data, error: null };
        } catch (error) {
          return { data: null, error };
        }
      };
      pending = transport.then(work, work);
      transport = pending;
      return pending;
    };
    return {
      abortSignal: run,
      then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) =>
        run().then(resolve, reject),
    };
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
  return <QueryClientProvider client={client}><DriverMonitoring /></QueryClientProvider>;
}

async function openCreate(driverName: string) {
  render(<Story />);
  fireEvent.click(screen.getByRole('button', { name: 'Novo Monitoramento' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Motorista'), { target: { value: driverName } });
  return dialog;
}

describe('driver monitor screen backed by the canonical SQL command', { timeout: 15000 }, () => {
  it('creates through only one RPC and closes after a compatible confirmation', async () => {
    const dialog = await openCreate('Motorista novo');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar monitoramento' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(mock.rpc.mock.calls[0][0]).toBe('apply_driver_monitor_command');
    expect(mock.from).not.toHaveBeenCalled();
    expect((await db.query('select count(*)::int count from driver_route_monitors')).rows[0])
      .toEqual({ count: 2 });
  });

  it('keeps a lost response visible and retries the exact request UUID', async () => {
    mock.lost = true;
    const dialog = await openCreate('Motorista resposta perdida');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar monitoramento' }));
    await within(dialog).findByText('Resposta perdida após confirmação no banco');
    const request = pendingDriverMonitorCommand(localStorage, i.tenant, i.operator)!.payload.request_id;
    expect(within(dialog).getByRole('button', { name: 'Criar monitoramento' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Recuperar alteração' }));
    await waitFor(() =>
      expect(mock.success).toHaveBeenCalledWith('Monitoramento recuperado e confirmado'));
    expect(mock.rpc.mock.calls.map(([, args]) => args._payload.request_id))
      .toEqual([request, request]);
    expect((await db.query('select count(*)::int count from driver_route_monitors')).rows[0])
      .toEqual({ count: 2 });
    expect(pendingDriverMonitorCommand(localStorage, i.tenant, i.operator)).toBeNull();
  });

  it('edits with expected revision and writes one additional history row', async () => {
    render(<Story />);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Observações'), {
      target: { value: 'Editado pela tela QA' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect((await db.query<{ notes: string; revision: number }>(
      'select notes,revision::int revision from driver_route_monitors where id=$1',
      [mock.row!.id],
    )).rows[0]).toEqual({ notes: 'Editado pela tela QA', revision: 1 });
    expect((await db.query('select count(*)::int count from driver_monitoring_history')).rows[0])
      .toEqual({ count: 2 });
  });

  it('keeps the edit dialog open and fails closed on revision conflict', async () => {
    render(<Story />);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog');
    await db.query("update driver_route_monitors set notes='Mudança concorrente' where id=$1", [mock.row!.id]);
    fireEvent.change(within(dialog).getByLabelText('Observações'), {
      target: { value: 'Tentativa obsoleta' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar alterações' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'mudou em outra sessão',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect((await db.query('select count(*)::int count from driver_monitoring_history')).rows[0])
      .toEqual({ count: 1 });
  });

  it('disables duplicate submission while the command is in flight', async () => {
    mock.delay = true;
    const dialog = await openCreate('Motorista lento');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar monitoramento' }));
    expect(await within(dialog).findByRole('button', { name: 'Salvando…' })).toBeDisabled();
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    mock.release?.();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  });
});
