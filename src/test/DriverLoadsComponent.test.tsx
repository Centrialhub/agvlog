import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DriverLoads from '@/pages/driver/DriverLoads';

const ids = {
  tenant: '74000000-0000-4000-8000-000000000001',
  actor: '74000000-0000-4000-8000-000000000002',
  driver: '74000000-0000-4000-8000-000000000003',
  load: '74000000-0000-4000-8000-000000000004',
  trip: '74000000-0000-4000-8000-000000000005',
  load2: '74000000-0000-4000-8000-000000000006',
};
const mocks = vi.hoisted(() => ({
  loadStatus: 'in_transit', tripStatus: 'planned', started: null as string | null,
  rpc: vi.fn(), navigate: vi.fn(), failRead: false, paginated: false,
}));
vi.mock('@/hooks/useCurrentDriver', () => ({ useCurrentDriver: () => ({ data: { id: ids.driver, name: 'Motorista QA' }, isLoading: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: ids.actor } }) }));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: ids.tenant } }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/driver/DriverLoadNotes', () => ({
  default: ({ loadId }: { loadId: string }) => <div data-testid={'fiscal-catalog-' + loadId}>Documentos fiscais</div>,
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  rpc: mocks.rpc,
} }));
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadStatus = 'in_transit'; mocks.tripStatus = 'planned'; mocks.started = null; mocks.failRead = false; mocks.paginated = false;
  mocks.rpc.mockImplementation((name: string, args?: { _cursor?: { id: string } | null; _search?: string; _status?: string }) => {
    if (name === 'list_driver_loads_page_v1') {
      const secondPage = !!args?._cursor;
      const createdAt = secondPage ? '2026-09-01T09:00:00.000Z' : '2026-09-01T10:00:00.000Z';
      const loadId = secondPage ? ids.load2 : ids.load;
      return {
        abortSignal: async () => ({
          data: {
            version: 1, tenant_id: ids.tenant, actor_id: ids.actor, driver_id: ids.driver,
            search: args?._search ?? null, status: args?._status ?? null,
            next_cursor: mocks.paginated && !secondPage ? {
              scope: 'a'.repeat(64), snapshot_at: '2026-09-01T11:00:00.000Z', created_at: createdAt, id: loadId,
            } : null,
            items: [{
              id: loadId, tenant_id: ids.tenant, load_number: secondPage ? '1004' : '1003', status: mocks.loadStatus,
              origin: 'Origem', destination: 'Destino', scheduled_load_at: null,
              total_pallet_count: 0, total_weight_kg: 0, created_at: createdAt, vehicles: null,
              dispatch_trip_loads: [{ dispatch_trip_id: ids.trip, dispatch_trips: { status: mocks.tripStatus, actual_start_at: mocks.started } }],
            }],
          },
          error: mocks.failRead ? new Error('offline') : null,
        }),
      };
    }
    return Promise.resolve({ data: { trip_id: ids.trip, status: 'in_transit', load_ids: [ids.load], changed: true }, error: null });
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); });
const show = () => render(<QueryClientProvider client={client}><DriverLoads /></QueryClientProvider>);

describe('driver load screen reconciliation', () => {
  it('shows an operational review instead of offering a new departure for inconsistent history', async () => {
    show();
    const button = await screen.findByRole('button', { name: 'Revisão operacional necessária' });
    expect(button).toBeDisabled();
    expect(screen.getByText(/Confirme o início histórico com a operação/).closest('[role="status"]')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Iniciar Viagem' })).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'driver_start_trip')).toBe(false);
    expect(screen.getByTestId('fiscal-catalog-' + ids.load)).toBeInTheDocument();
  });
  it('offers a normal start when load and trip are both waiting for departure', async () => {
    mocks.loadStatus = 'ready';
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar Viagem' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('driver_start_trip', { _trip_id: ids.trip }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/driver/stops?trip=' + ids.trip));
  });
  it('opens an actually started trip without another departure RPC', async () => {
    mocks.tripStatus = 'in_transit'; mocks.started = '2026-08-29T12:00:00Z';
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Acessar Viagem' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/driver/stops?trip=' + ids.trip);
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'driver_start_trip')).toBe(false);
  });
  it('does not turn a backend read failure into an empty list or a departure action', async () => {
    mocks.failRead = true;
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar suas cargas');
    expect(screen.queryByText('Nenhuma carga encontrada')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Iniciar Viagem' })).not.toBeInTheDocument();
  });
  it('loads the next keyset page without replacing the first load', async () => {
    mocks.paginated = true;
    show();
    expect(await screen.findByText('Carga 1003')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais cargas' }));
    expect(await screen.findByText('Carga 1004')).toBeInTheDocument();
    expect(screen.getByText('Carga 1003')).toBeInTheDocument();
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'list_driver_loads_page_v1')).toHaveLength(2);
  });
});
