import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DriverChecklist from '@/pages/driver/DriverChecklist';
import DriverIssues from '@/pages/driver/DriverIssues';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  readLatest: vi.fn(),
  put: vi.fn(),
  history: vi.fn(),
  submit: vi.fn(),
  commands: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: 'tenant-a' } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'actor-a' } }) }));
vi.mock('@/hooks/useCurrentDriver', () => ({
  useCurrentDriver: () => ({ data: null, isError: true, isPending: false, refetch: vi.fn() }),
  useActiveTrip: () => ({ data: null, isError: true, isPending: false, refetch: vi.fn() }),
}));
vi.mock('@/hooks/useDriverJourneyContext', () => ({
  useDriverJourneyContext: () => ({ data: null, isError: true, isPending: false, refetch: vi.fn() }),
}));
vi.mock('@/hooks/useChecklistStatus', () => ({ useChecklistStatus: () => ({
  preCompleted: false, postCompleted: false, preCheckedCount: 0, postCheckedCount: 0,
  preTotalCount: 8, postTotalCount: 5, preItems: [], postItems: [], pre: null, post: null,
  preBoundaryId: null, postBoundaryId: 'journey-start', isLoading: false, isFetching: false,
  isError: true, refetch: vi.fn(),
}) }));
vi.mock('@/hooks/useDriverOperationalOffline', () => ({ useDriverOperationalOffline: () => ({
  submit: mocks.submit, recover: vi.fn(), pending: mocks.commands.length, commands: mocks.commands,
  syncing: false, online: false,
}) }));
vi.mock('@/hooks/useDriverOperationalEventHistory', () => ({
  useDriverOperationalEventHistory: (input: unknown) => {
    mocks.history(input);
    return { data: undefined, error: new Error('offline'), isPending: false, refetch: vi.fn(),
      fetchNextPage: vi.fn(), hasNextPage: false, isFetchingNextPage: false };
  },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/driver/DriverConversation', () => ({ EventConversation: () => <div>Conversa</div> }));
vi.mock('@/lib/driver/driverOperationalOffline', () => ({ driverOperationalSnapshotStore: {
  read: mocks.read, readLatest: mocks.readLatest, put: mocks.put, remove: vi.fn(),
} }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: () => {
    const query = {
      select: () => query, eq: () => query, order: () => query,
      maybeSingle: async () => ({ data: null, error: { message: 'offline' } }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'offline' } }).then(resolve),
    };
    return query;
  },
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
  removeChannel: vi.fn(),
} }));

const snapshot = {
  version: 1 as const,
  tenantId: 'tenant-a', actorId: 'actor-a', tripId: 'trip-a', cachedAt: '2026-09-10T12:00:00Z',
  trip: { id: 'trip-a', status: 'in_transit', actualStartAt: '2026-09-10T10:00:00Z', actualEndAt: null,
    driver: { id: 'driver-a', name: 'Motorista Offline' }, vehicle: null },
  loads: [],
  stops: [{ id: 'stop-a', order: 1, status: 'pending', destination: 'Rua Offline', latitude: null,
    longitude: null, notes: null, client: { id: 'client-a', name: 'Cliente Offline' },
    actualArrivalAt: null, actualDepartureAt: null }],
  documents: [], instructions: [],
  checklist: { pre: { id: 'check-pre', boundaryId: null, checkedItems: [0, 1] },
    post: { id: null, boundaryId: 'journey-start', checkedItems: [] } },
  journey: { events: [], lastStartId: 'journey-start', lastEndId: null },
  occurrences: [{ id: 'event-cached', tenant_id: 'tenant-a', driver_id: 'driver-a',
    dispatch_trip_id: 'trip-a', dispatch_stop_id: 'stop-a', event_type: 'damaged', severity: 'medium',
    description: 'Avaria salva antes de ficar offline', report_details: null, payload: null,
    created_at: '2026-09-10T11:00:00Z' }],
  cargo: null,
};

let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.commands = [];
  mocks.read.mockResolvedValue(snapshot);
  mocks.readLatest.mockResolvedValue(snapshot);
  mocks.put.mockResolvedValue(undefined);
  mocks.submit.mockResolvedValue({ queued: true });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); });

function show(path: string, child: ReactNode) {
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>
    <Routes><Route path="/driver/*" element={child} /></Routes>
  </MemoryRouter></QueryClientProvider>);
}

describe('authenticated auxiliary driver routes reopened offline', () => {
  it('reopens checklist after a hard reload and overlays its pending command', async () => {
    mocks.commands = [{ id: 'request-checklist', kind: 'checklist', aggregateId: 'trip-a',
      payload: { trip_id: 'trip-a', kind: 'pre', checklist_payload: { checked_items: [0, 1, 2],
        total_items: 8, expected_checklist_id: 'check-pre', expected_boundary_id: null } } }];
    const first = show('/driver/checklist', <DriverChecklist />);
    await screen.findByText('Dados salvos no aparelho. Novas marcações entrarão na fila de sincronização.');
    expect(screen.getByText(/3\/8 itens/)).toHaveTextContent('Sincronização pendente');
    first.unmount();

    show('/driver/checklist', <DriverChecklist />);
    await screen.findByText('Dados salvos no aparelho. Novas marcações entrarão na fila de sincronização.');
    expect(mocks.readLatest).toHaveBeenCalledTimes(2);
    expect(mocks.readLatest).toHaveBeenNthCalledWith(2, 'tenant-a', 'actor-a');
  });

  it('opens a direct checklist link from the exact scoped trip snapshot', async () => {
    show('/driver/checklist?trip=trip-a', <DriverChecklist />);
    await screen.findByText('Dados salvos no aparelho. Novas marcações entrarão na fila de sincronização.');
    expect(mocks.read).toHaveBeenCalledWith('tenant-a', 'actor-a', 'trip-a');
    expect(mocks.readLatest).not.toHaveBeenCalled();
  });

  it('reopens occurrences from saved history and overlays a pending occurrence', async () => {
    mocks.commands = [{ id: 'request-occurrence', kind: 'occurrence', aggregateId: 'trip-a',
      tenantId: 'tenant-a', actorId: 'actor-a', createdAt: '2026-09-10T11:30:00Z',
      payload: { trip_id: 'trip-a', event_type: 'wrong_address', severity: 'high',
        description: 'Endereço divergente pendente', stop_id: 'stop-a', client_id: 'client-a' } }];
    show('/driver/issues', <DriverIssues />);
    await screen.findByText('Avaria salva antes de ficar offline');
    expect(screen.getByText('Endereço divergente pendente')).toBeInTheDocument();
    expect(screen.getByText('Pendente')).toBeInTheDocument();
    expect(screen.getByText(/Histórico salvo no aparelho/)).toBeInTheDocument();
    expect(mocks.history).toHaveBeenLastCalledWith(expect.objectContaining({ driverId: 'driver-a', tripId: 'trip-a' }));
  });

  it('reopens the direct occurrences route using only the current tenant and actor scope', async () => {
    const first = show('/driver/issues', <DriverIssues />);
    await screen.findByText('Avaria salva antes de ficar offline');
    first.unmount();
    show('/driver/issues', <DriverIssues />);
    await screen.findByText('Avaria salva antes de ficar offline');
    expect(mocks.readLatest).toHaveBeenNthCalledWith(2, 'tenant-a', 'actor-a');
  });
});
