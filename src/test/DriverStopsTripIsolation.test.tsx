import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DriverStops from '@/pages/driver/DriverStops';
import { saveDriverRouteSnapshot } from '@/lib/driver/offlineRouteSnapshot';
import type { DriverOperationalSnapshot } from '@/lib/driver/driverOperationalOffline';

type Result = { data: unknown; error: unknown };
const mocks = vi.hoisted(() => ({
  tenant: 'tenant-a', actor: 'actor-a', driver: { id: 'driver-a', tenant_id: 'tenant-a', active: true },
  driverPending: false, driverError: null as unknown, autoTrip: null as unknown,
  trips: new Map<string, Result | Promise<Result>>(), stops: new Map<string, Result | Promise<Result>>(),
  snapshots: new Map<string, unknown>(), read: vi.fn(), put: vi.fn(), submit: vi.fn(), calls: vi.fn(),
  commands: [] as Array<Record<string, unknown>>,
}));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: mocks.tenant } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mocks.actor } }) }));
vi.mock('@/hooks/useCurrentDriver', () => ({
  useCurrentDriver: () => ({ data: mocks.driverPending ? undefined : mocks.driver, error: mocks.driverError,
    isSuccess: !mocks.driverPending && !mocks.driverError, isLoading: mocks.driverPending && navigator.onLine, refetch: vi.fn() }),
  useActiveTrip: () => ({ data: mocks.autoTrip, error: null, isLoading: false, refetch: vi.fn() }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/useDriverOperationalOffline', () => ({ useDriverOperationalOffline: () => ({ commands: mocks.commands, submit: mocks.submit }) }));
vi.mock('@/lib/driverLocation', () => ({ getCurrentDriverLocation: async () => ({ latitude: -15, longitude: -43, accuracyM: 10 }) }));
vi.mock('@/lib/driver/driverOperationalOffline', () => ({ driverOperationalSnapshotStore: { read: mocks.read, put: mocks.put } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: (table: string) => {
    const tenant = mocks.tenant, actor = mocks.actor;
    const filters: Record<string, string> = {};
    const result = () => {
      const trip = filters.id ?? filters.dispatch_trip_id;
      mocks.calls(table, tenant, actor, trip, { ...filters });
      return Promise.resolve((table === 'dispatch_trips' ? mocks.trips : mocks.stops).get(`${tenant}|${actor}|${trip}`)
        ?? { data: table === 'dispatch_stops' ? [] : null, error: null });
    };
    const query = { select: () => query, eq: (key: string, value: string) => { filters[key] = value; return query; },
      order: () => query, maybeSingle: result,
      then: (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) => result().then(resolve, reject),
    };
    return query;
  },
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; }, removeChannel: vi.fn(),
} }));

const scoped = (trip: string, tenant = mocks.tenant, actor = mocks.actor) => `${tenant}|${actor}|${trip}`;
const row = (trip: string) => ({ id: trip, tenant_id: mocks.tenant, driver_id: mocks.driver.id, status: 'in_transit',
  actual_start_at: '2026-10-06T12:00:00Z', vehicles: null,
  dispatch_trip_loads: [{ load_id: `load-${trip}`, loads: { id: `load-${trip}`, load_number: trip === 'trip-a' ? '1001' : '2002',
    origin: 'Origem QA', destination: 'Destino QA', status: 'in_transit' } }],
});
const stop = (trip: string, index = 1) => ({ id: `stop-${trip}-${index}`, status: 'arrived', stop_order: index,
  destination: `Endereço ${trip}-${index}`, clients: { company_name: `Cliente ${trip}-${index}` },
  actual_arrival_at: '2026-10-06T12:30:00Z', actual_departure_at: null, latitude: -15, longitude: -43, notes: null,
});
function saved(trip: string, tenant = mocks.tenant, actor = mocks.actor): DriverOperationalSnapshot {
  return { version: 1, tenantId: tenant, actorId: actor, tripId: trip, cachedAt: new Date().toISOString(),
    trip: { id: trip, status: 'in_transit', actualStartAt: '2026-10-06T12:00:00Z', actualEndAt: null,
      driver: { id: mocks.driver.id, name: 'Motorista QA' }, vehicle: null },
    loads: [{ id: `load-${trip}`, loadNumber: trip === 'trip-a' ? '1001' : '2002', status: 'in_transit', origin: null,
      destination: null, volumeCount: null, palletCount: null, weightKg: null }],
    stops: [{ id: `stop-${trip}-1`, order: 1, status: 'arrived', destination: `Endereço ${trip}-1`,
      latitude: -15, longitude: -43, notes: null, actualArrivalAt: '2026-10-06T12:30:00Z', actualDepartureAt: null,
      client: { id: null, name: `Cliente ${trip}-1` } }],
    documents: [], instructions: [], checklist: { pre: { id: null, boundaryId: null, checkedItems: [] },
      post: { id: null, boundaryId: null, checkedItems: [] } }, journey: { events: [], lastStartId: null, lastEndId: null }, cargo: null,
  };
}
function legacy(trip: string) {
  saveDriverRouteSnapshot({ tenantId: mocks.tenant, userId: mocks.actor, driver: { id: mocks.driver.id, name: 'Motorista QA' },
    trip: { id: trip, status: 'in_transit', actual_start_at: '2026-10-06T12:00:00Z', loads: { load_number: trip === 'trip-a' ? '1001' : '2002' } }, stops: [stop(trip)],
  });
}
function Controls() {
  const navigate = useNavigate();
  return <><button onClick={() => navigate('/driver/stops?trip=trip-a')}>Ver A</button>
    <button onClick={() => navigate('/driver/stops?trip=trip-b')}>Ver B</button><DriverStops /></>;
}
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); mocks.trips.clear(); mocks.stops.clear(); mocks.snapshots.clear(); mocks.commands = [];
  mocks.tenant = 'tenant-a'; mocks.actor = 'actor-a'; mocks.driver = { id: 'driver-a', tenant_id: 'tenant-a', active: true };
  mocks.driverPending = false; mocks.driverError = null; mocks.autoTrip = { ...row('trip-a'), loads: { id: 'load-trip-a', load_number: '1001' } };
  mocks.trips.set(scoped('trip-a'), { data: row('trip-a'), error: null });
  mocks.stops.set(scoped('trip-a'), { data: Array.from({ length: 5 }, (_, i) => stop('trip-a', i + 1)), error: null });
  mocks.read.mockImplementation(async (tenant, actor, trip) => mocks.snapshots.get(scoped(trip, tenant, actor)) ?? null);
  mocks.put.mockImplementation(async snapshot => { mocks.snapshots.set(scoped(snapshot.tripId, snapshot.tenantId, snapshot.actorId), snapshot); });
  mocks.submit.mockResolvedValue({ queued: true });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }); onlineManager.setOnline(true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); onlineManager.setOnline(true); localStorage.clear(); });
function show(trip = 'trip-a') {
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/driver/stops?trip=${trip}`]}><Controls /></MemoryRouter></QueryClientProvider>);
}
function offline() { Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }); onlineManager.setOnline(false); }
const noA = () => { expect(screen.queryByText(/Cliente trip-a-/)).not.toBeInTheDocument(); expect(screen.queryByText(/Carga 1001/)).not.toBeInTheDocument(); };
async function warmA() { await screen.findByText(/Carga 1001.*5 parada/); await waitFor(() => expect(mocks.put).toHaveBeenCalled()); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('requested stop trip isolation', () => {
  it('does not use warmed trip A after requested trip B returns an authorized empty read', async () => {
    show(); await warmA(); fireEvent.click(screen.getByRole('button', { name: 'Ver B' }));
    expect(await screen.findByText('Viagem indisponível')).toBeInTheDocument(); noA();
    expect(screen.queryByRole('button', { name: 'Registrar resultado da entrega' })).not.toBeInTheDocument();
    expect(mocks.calls).toHaveBeenCalledWith('dispatch_trips', 'tenant-a', 'actor-a', 'trip-b', {
      id: 'trip-b', tenant_id: 'tenant-a', driver_id: 'driver-a',
    });
    expect(client.getQueryState(['driver_trip_specific', 'tenant-a', 'driver-a', 'trip-b', 'actor-a'])).toMatchObject({ status: 'success', data: null });
  });
  it.each([{ message: 'transport failed' }, { code: '42501', message: 'denied' }, { code: '403', message: 'forbidden' }])('does not substitute A after B errors: %s', async error => {
    mocks.trips.set(scoped('trip-b'), { data: null, error }); show(); await warmA();
    fireEvent.click(screen.getByRole('button', { name: 'Ver B' }));
    await screen.findByText('Falha ao carregar a viagem'); noA();
    expect(screen.queryByRole('button', { name: 'Registrar saída' })).not.toBeInTheDocument();
  });
  it('loads B independently when there is no automatically active trip', async () => {
    mocks.autoTrip = null; mocks.trips.set(scoped('trip-b'), { data: row('trip-b'), error: null });
    mocks.stops.set(scoped('trip-b'), { data: [stop('trip-b')], error: null });
    show('trip-b'); await screen.findByText(/Carga 2002.*1 parada/); noA();
  });
  it('hides B cached data after an authoritative empty refresh, even after going offline', async () => {
    mocks.trips.set(scoped('trip-b'), { data: row('trip-b'), error: null }); mocks.stops.set(scoped('trip-b'), { data: [stop('trip-b')], error: null });
    show('trip-b'); await screen.findByText(/Carga 2002.*1 parada/);
    mocks.trips.set(scoped('trip-b'), { data: null, error: null });
    await act(async () => { await client.refetchQueries({ queryKey: ['driver_trip_specific'] }); });
    await screen.findByText('Viagem indisponível');
    await act(async () => { offline(); window.dispatchEvent(new Event('offline')); });
    expect(screen.queryByText(/Cliente trip-b-/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar saída' })).not.toBeInTheDocument();
  });
  it('does not re-enable a saved B route after an explicit denial with previously cached live data', async () => {
    mocks.trips.set(scoped('trip-b'), { data: row('trip-b'), error: null }); mocks.stops.set(scoped('trip-b'), { data: [stop('trip-b')], error: null });
    show('trip-b'); await screen.findByText(/Carga 2002.*1 parada/);
    mocks.trips.set(scoped('trip-b'), { data: null, error: { code: '42501', message: 'revoked' } });
    await act(async () => { await client.refetchQueries({ queryKey: ['driver_trip_specific'] }); });
    await screen.findByText('Falha ao carregar a viagem');
    await act(async () => { offline(); window.dispatchEvent(new Event('offline')); });
    expect(screen.queryByText(/Cliente trip-b-/)).not.toBeInTheDocument();
  });
  it.each(['actor', 'tenant'] as const)('does not reuse the previous %s query or snapshot with the same driver/trip IDs', async field => {
    mocks.trips.set(scoped('trip-b'), { data: row('trip-b'), error: null }); mocks.stops.set(scoped('trip-b'), { data: [stop('trip-b')], error: null });
    const page = show('trip-b'); await screen.findByText(/Carga 2002.*1 parada/);
    mocks[field] = 'other'; mocks.driver = { ...mocks.driver, tenant_id: mocks.tenant };
    page.rerender(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/driver/stops?trip=trip-b']}><Controls /></MemoryRouter></QueryClientProvider>);
    expect(screen.queryByText(/Cliente trip-b-/)).not.toBeInTheDocument();
    await screen.findByText('Viagem indisponível');
    expect(mocks.calls).toHaveBeenCalledWith('dispatch_trips', mocks.tenant, mocks.actor, 'trip-b', expect.any(Object));
  });
  it('ignores a late A network response after B has resolved empty', async () => {
    const pending = deferred<Result>(); mocks.trips.set(scoped('trip-a'), pending.promise);
    show(); fireEvent.click(screen.getByRole('button', { name: 'Ver B' })); await screen.findByText('Viagem indisponível');
    await act(async () => { pending.resolve({ data: row('trip-a'), error: null }); });
    noA(); expect(screen.getByText('Viagem indisponível')).toBeInTheDocument();
  });
  it('reads the exact B operational cache offline even with the legacy A route and no driver lookup', async () => {
    legacy('trip-a'); mocks.snapshots.set(scoped('trip-b'), saved('trip-b')); mocks.driverPending = true; mocks.autoTrip = null; offline();
    show('trip-b'); await screen.findByText(/Carga 2002.*1 parada/); noA();
    expect(mocks.read).toHaveBeenCalledWith('tenant-a', 'actor-a', 'trip-b'); expect(mocks.calls).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Registrar saída' }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith({ kind: 'departure', aggregateId: 'trip-b', payload: { trip_id: 'trip-b', stop_id: 'stop-trip-b-1', notes: null } }));
  });
  it('uses the exact legacy B cache offline when its operational cache is absent', async () => {
    legacy('trip-b'); mocks.autoTrip = null; offline(); show('trip-b');
    await screen.findByText(/Carga 2002.*1 parada/); noA(); expect(mocks.calls).not.toHaveBeenCalled();
  });
  it('reports offline unavailability for B when only A is saved', async () => {
    legacy('trip-a'); mocks.snapshots.set(scoped('trip-a'), saved('trip-a')); offline(); show('trip-b');
    expect(await screen.findByRole('alert')).toHaveTextContent('Paradas indisponíveis offline'); noA();
    expect(screen.queryByRole('button', { name: 'Registrar saída' })).not.toBeInTheDocument();
  });
  it('ignores a late A snapshot read after B cache is loaded', async () => {
    offline(); const pending = deferred<DriverOperationalSnapshot | null>();
    mocks.read.mockImplementation(async (_tenant, _actor, trip) => trip === 'trip-a' ? pending.promise : saved('trip-b'));
    show(); fireEvent.click(screen.getByRole('button', { name: 'Ver B' })); await screen.findByText(/Carga 2002.*1 parada/);
    await act(async () => { pending.resolve(saved('trip-a')); }); noA();
    expect(screen.getByText(/Carga 2002.*1 parada/)).toBeInTheDocument();
  });
  it.each(['actor', 'tenant'] as const)('ignores late cache reads across %s changes', async field => {
    offline(); const pending = deferred<DriverOperationalSnapshot | null>();
    const previous = saved('trip-b'); mocks.read.mockReturnValue(pending.promise);
    const page = show('trip-b'); mocks[field] = 'other'; mocks.driver = { ...mocks.driver, tenant_id: mocks.tenant };
    mocks.read.mockResolvedValue(saved('trip-b'));
    page.rerender(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/driver/stops?trip=trip-b']}><Controls /></MemoryRouter></QueryClientProvider>);
    await screen.findByText(/Carga 2002.*1 parada/);
    await act(async () => { pending.resolve(previous); });
    expect(screen.getByText(/Carga 2002.*1 parada/)).toBeInTheDocument();
    expect(mocks.read).toHaveBeenLastCalledWith(mocks.tenant, mocks.actor, 'trip-b');
  });
  it('rejects an operational readback from another actor rather than mixing it with the route', async () => {
    offline(); mocks.read.mockResolvedValue(saved('trip-b', 'tenant-a', 'other-actor')); show('trip-b');
    expect(await screen.findByRole('alert')).toHaveTextContent('Paradas indisponíveis offline');
  });
  it.each(['tenant', 'actor'] as const)('filters queued overlays from another %s even when trip and stop IDs match', async field => {
    offline(); const snapshot = saved('trip-b'); snapshot.stops[0].actualArrivalAt = null; snapshot.stops[0].status = 'pending';
    mocks.snapshots.set(scoped('trip-b'), snapshot);
    mocks.commands = [{ kind: 'arrival', aggregateId: 'trip-b', tenantId: field === 'tenant' ? 'other-tenant' : 'tenant-a', actorId: field === 'actor' ? 'other-actor' : 'actor-a', createdAt: new Date().toISOString(), payload: { stop_id: 'stop-trip-b-1' } }];
    show('trip-b'); await screen.findByText(/Carga 2002.*1 parada/);
    expect(screen.getByRole('button', { name: 'Cheguei' })).toBeInTheDocument();
    expect(screen.queryByText('Sincronização pendente')).not.toBeInTheDocument();
  });
});

it('keeps valid queued overlays on the exact B cache', async () => {
  offline(); const snapshot = saved('trip-b'); snapshot.stops[0].actualArrivalAt = null; snapshot.stops[0].status = 'pending';
  mocks.snapshots.set(scoped('trip-b'), snapshot);
  mocks.commands = [{ kind: 'arrival', aggregateId: 'trip-b', tenantId: 'tenant-a', actorId: 'actor-a',
    createdAt: new Date().toISOString(), payload: { stop_id: 'stop-trip-b-1' } }];
  show('trip-b'); await screen.findByText(/Carga 2002.*1 parada/);
  expect(screen.getByText('Sincronização pendente')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Registrar saída' })).toBeEnabled();
});
it('does not restore old stops after a successful empty stop read when going offline', async () => {
  mocks.trips.set(scoped('trip-b'), { data: row('trip-b'), error: null }); mocks.stops.set(scoped('trip-b'), { data: [stop('trip-b')], error: null });
  show('trip-b'); await screen.findByText(/Carga 2002.*1 parada/);
  mocks.stops.set(scoped('trip-b'), { data: [], error: null });
  await act(async () => { await client.refetchQueries({ queryKey: ['driver_stops'] }); });
  await screen.findByText('Nenhuma parada programada para esta viagem.');
  await act(async () => { offline(); window.dispatchEvent(new Event('offline')); });
  expect(screen.queryByText(/Cliente trip-b-/)).not.toBeInTheDocument();
  expect(screen.getByText('Nenhuma parada programada para esta viagem.')).toBeInTheDocument();
});
it('does not publish a late A persistence read into B or refresh the old snapshot after route switch', async () => {
  const pending = deferred<DriverOperationalSnapshot | null>();
  mocks.read.mockImplementation(async (_tenant, _actor, trip) => trip === 'trip-a' ? pending.promise : null);
  mocks.trips.set(scoped('trip-b'), { data: row('trip-b'), error: null }); mocks.stops.set(scoped('trip-b'), { data: [stop('trip-b')], error: null });
  show(); await screen.findByText(/Carga 1001.*5 parada/);
  fireEvent.click(screen.getByRole('button', { name: 'Ver B' })); await screen.findByText(/Carga 2002.*1 parada/);
  await waitFor(() => expect(mocks.put).toHaveBeenCalled());
  await act(async () => { pending.resolve(saved('trip-a')); });
  noA(); expect(screen.getByText(/Carga 2002.*1 parada/)).toBeInTheDocument();
  expect(mocks.put.mock.calls.every(([snapshot]) => snapshot.tripId === 'trip-b')).toBe(true);
});
