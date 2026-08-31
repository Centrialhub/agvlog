import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DriverLoads from '@/pages/driver/DriverLoads';

const mocks = vi.hoisted(() => ({
  loadStatus: 'in_transit', tripStatus: 'planned', started: null as string | null,
  rpc: vi.fn(), navigate: vi.fn(), failRead: false,
}));
vi.mock('@/hooks/useCurrentDriver', () => ({ useCurrentDriver: () => ({ data: { id: 'driver' }, isLoading: false, isError: false, refetch: vi.fn() }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  rpc: mocks.rpc,
  from: () => {
    const query = {
      select: () => query, eq: () => query, order: () => query,
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({
        data: [{ id: 'load', load_number: '1003', status: mocks.loadStatus,
          origin: 'Origem', destination: 'Destino', vehicles: null,
          dispatch_trip_loads: [{ dispatch_trip_id: 'trip', dispatch_trips: { status: mocks.tripStatus, actual_start_at: mocks.started } }],
        }], error: mocks.failRead ? new Error('offline') : null,
      }).then(resolve),
    };
    return query;
  },
} }));
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadStatus = 'in_transit'; mocks.tripStatus = 'planned'; mocks.started = null; mocks.failRead = false;
  mocks.rpc.mockResolvedValue({ data: { trip_id:'trip',status:'in_transit',load_ids:['load'],changed:true }, error: null });
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
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('offers a normal start when load and trip are both waiting for departure', async () => {
    mocks.loadStatus = 'ready';
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar Viagem' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('driver_start_trip', { _trip_id: 'trip' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/driver/stops?trip=trip'));
  });
  it('opens an actually started trip without another departure RPC', async () => {
    mocks.tripStatus = 'in_transit'; mocks.started = '2026-08-29T12:00:00Z';
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Acessar Viagem' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/driver/stops?trip=trip');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('does not turn a backend read failure into an empty list or a departure action', async () => {
    mocks.failRead = true;
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar suas cargas');
    expect(screen.queryByText('Nenhuma carga encontrada')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Iniciar Viagem' })).not.toBeInTheDocument();
  });
});
