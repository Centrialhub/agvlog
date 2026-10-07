import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DriverChecklist from '@/pages/driver/DriverChecklist';
import type { DriverOperationalSnapshot } from '@/lib/driver/driverOperationalOffline';

const mocks = vi.hoisted(() => ({ read: vi.fn(), put: vi.fn(), rpc: vi.fn(), from: vi.fn(), submit: vi.fn(), revoked: false }));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: 'tenant-a' } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'actor-a' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/useDriverOperationalOffline', async () => {
  const { useOnlineStatus } = await import('@/hooks/useOnlineStatus');
  return { useDriverOperationalOffline: () => ({ online: useOnlineStatus(), commands: [], submit: mocks.submit }) };
});
vi.mock('@/lib/driver/driverOperationalOffline', () => ({ driverOperationalSnapshotStore: {
  read: mocks.read, readLatest: mocks.read, put: mocks.put,
} }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: mocks.from, rpc: mocks.rpc,
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
  removeChannel: vi.fn(),
} }));

const saved: DriverOperationalSnapshot = {
  version: 1, tenantId: 'tenant-a', actorId: 'actor-a', tripId: 'trip-a', cachedAt: '2026-10-06T12:00:00Z',
  trip: { id: 'trip-a', status: 'in_transit', actualStartAt: '2026-10-06T10:00:00Z', actualEndAt: null,
    driver: { id: 'driver-a', name: 'Motorista QA' }, vehicle: null },
  loads: [], stops: [], documents: [], instructions: [],
  checklist: { pre: { id: 'check-pre', boundaryId: null, checkedItems: [0, 1] },
    post: { id: null, boundaryId: 'start-a', checkedItems: [] } },
  journey: { events: [], lastStartId: 'start-a', lastEndId: null }, cargo: null,
};
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks(); mocks.revoked = false; mocks.read.mockResolvedValue(null); mocks.put.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }); onlineManager.setOnline(false);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.rpc.mockImplementation(async name => ({ data: name === 'current_driver_id'
    ? mocks.revoked ? null : 'driver-a' : { events: [], last_start: null, last_end: null }, error: null }));
  mocks.from.mockImplementation(table => {
    const trip = { id: 'trip-a', status: 'in_transit', actual_start_at: '2026-10-06T10:00:00Z',
      actual_end_at: null, vehicles: null, dispatch_trip_loads: [] };
    const data = table === 'drivers' ? { id: 'driver-a', tenant_id: 'tenant-a', active: true, name: 'Motorista QA' }
      : table === 'dispatch_trips' ? trip : null;
    const query = { select: () => query, eq: () => query, in: () => query, order: () => query, limit: () => query,
      single: async () => ({ data, error: null }),
      maybeSingle: async () => ({ data, error: null }),
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: data ? [data] : [], error: null }).then(resolve),
    };
    return query;
  });
});
afterEach(() => { cleanup(); client.clear(); onlineManager.setOnline(true); });
function show() {
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/driver/checklist?trip=trip-a']}>
    <DriverChecklist />
  </MemoryRouter></QueryClientProvider>);
}
async function reconnect() {
  await act(async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    window.dispatchEvent(new Event('online')); onlineManager.setOnline(true);
  });
}
describe('checklist with real paused query hooks and local transport fixtures', () => {
  it('ends the cold-cache loader while identity and journey queries remain paused', async () => {
    show(); expect(await screen.findByRole('alert')).toHaveTextContent('Checklist indisponível offline');
    expect(client.getQueryState(['current_driver', 'actor-a', 'tenant-a'])).toMatchObject({ status: 'pending', fetchStatus: 'paused' });
    expect(client.getQueryState(['driver_journey_events', 'tenant-a', 'actor-a'])).toMatchObject({ status: 'pending', fetchStatus: 'paused' });
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
  it('reopens the scoped saved checklist while its real network queries are paused', async () => {
    mocks.read.mockResolvedValue(saved);
    const first = show(); expect(await screen.findByRole('button', { name: 'Salvar Pré-Viagem' })).toBeEnabled();
    expect(screen.getByText(/2\/8 itens/)).toBeInTheDocument(); first.unmount();
    show(); expect(await screen.findByRole('button', { name: 'Salvar Pós-Viagem' })).toBeEnabled();
    expect(mocks.read).toHaveBeenCalledWith('tenant-a', 'actor-a', 'trip-a');
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  });
  it('loads the checklist after reconnecting from a cold cache', async () => {
    show(); await screen.findByRole('alert'); await reconnect();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar Pré-Viagem' })).toBeEnabled());
    expect(screen.queryByText(/Checklist indisponível offline/)).not.toBeInTheDocument();
    expect(mocks.rpc).toHaveBeenCalledWith('current_driver_id', { _tenant_id: 'tenant-a' });
    expect(client.getQueryState(['driver_checklist_trip', 'tenant-a', 'driver-a', 'trip-a'])?.status).toBe('success');
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it('removes cached checklist actions after a reconnect confirms revocation', async () => {
    mocks.read.mockResolvedValue(saved); mocks.revoked = true;
    show(); expect(await screen.findByRole('button', { name: 'Salvar Pré-Viagem' })).toBeEnabled();
    await reconnect(); expect(await screen.findByRole('alert')).toHaveTextContent('Nenhuma marcação será salva até atualizar');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument(); expect(mocks.submit).not.toHaveBeenCalled();
  });
});
