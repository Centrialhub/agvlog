import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DriverJourney from '@/pages/driver/DriverJourney';
import DriverIssues from '@/pages/driver/DriverIssues';
import { DriverChecklistSection } from '@/components/driver/DriverChecklistSection';
import { useDriverOperationalOffline } from '@/hooks/useDriverOperationalOffline';
import { driverOfflineOutbox } from '@/lib/driver/driverOfflineOutbox';

const state = vi.hoisted(() => ({
  tenant: '72000000-0000-4000-8000-000000000001', actor: '72000000-0000-4000-8000-000000000002',
  trip: '72000000-0000-4000-8000-000000000003', driver: '72000000-0000-4000-8000-000000000004',
  rpc: vi.fn(), toast: vi.fn(),
}));
const tenant = state.tenant, actor = state.actor;
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: state.actor } }) }));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: state.tenant } }) }));
vi.mock('@/hooks/useCurrentDriver', () => ({
  useCurrentDriver: () => ({ data: { id: state.driver }, refetch: vi.fn() }),
  useActiveTrip: () => ({ data: { id: state.trip }, refetch: vi.fn() }),
}));
vi.mock('@/hooks/useChecklistStatus', () => ({ useChecklistStatus: () => ({
  preCompleted: true, postCompleted: true, preTotalCount: 2, postTotalCount: 2, refetch: vi.fn(),
}) }));
vi.mock('@/hooks/useDriverJourneyContext', () => ({ useDriverJourneyContext: () => ({
  data: { events: [{ id: '72000000-0000-4000-8000-000000000005', dispatch_trip_id: state.trip,
    event_type: 'start_shift', event_at: '2026-10-14T04:00:00Z', created_at: '2026-10-14T04:00:00Z' }],
  last_start: null, last_end: null }, refetch: vi.fn(),
}) }));
vi.mock('@/hooks/useDriverOperationalEventHistory', () => ({ useDriverOperationalEventHistory: () => ({
  data: { items: [] }, isPending: false, refetch: vi.fn(),
}) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  rpc: (name: string, args: unknown) => state.rpc(name, args),
  from: () => { const query = { select: () => query, eq: () => query, order: () => Promise.resolve({ data: [], error: null }) }; return query; },
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
  removeChannel: vi.fn(),
} }));
vi.mock('@/lib/driver/driverOfflineOutbox', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/driver/driverOfflineOutbox')>();
  return { ...actual, driverOfflineOutbox: actual.createMemoryDriverOfflineOutbox() };
});
let client: QueryClient;
let operational: ReturnType<typeof useDriverOperationalOffline>;
function RecoveryProbe() { operational = useDriverOperationalOffline(); return null; }
type Mode = 'journey' | 'checklist' | 'occurrence';
async function mount(mode: Mode) {
  const node = () => <QueryClientProvider client={client}>
    {mode === 'journey' ? <DriverJourney /> : mode === 'occurrence' ? <DriverIssues /> :
      <DriverChecklistSection title="Pré-Viagem" kind="pre" items={['Pneus', 'Óleo']} tripId={state.trip}
        savedItems={[]} savedId={null} boundaryId={null} disabled={false} />}
    <RecoveryProbe />
  </QueryClientProvider>;
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(node()); await new Promise(resolve => setTimeout(resolve, 0)); });
  return { rerender: () => view.rerender(node()) };
}
async function submit(mode: Mode) {
  if (mode === 'journey') await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Almoço' })); });
  else if (mode === 'checklist') {
    await act(async () => { fireEvent.click(screen.getAllByRole('checkbox')[0]); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Salvar Pré-Viagem' })); });
  } else {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Nova' }));
    await user.click(screen.getByLabelText('Tipo'));
    await user.click(screen.getByRole('option', { name: /^Outro$/ }));
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Ocorrência sintética offline' } });
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Registrar Ocorrência' })); });
  }
}
beforeEach(async () => {
  vi.clearAllMocks(); state.tenant = tenant; state.actor = actor;
  onlineManager.setOnline(false); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  for (const row of await driverOfflineOutbox.list(tenant, actor)) await driverOfflineOutbox.remove(row.id);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  state.rpc.mockImplementation(async (_name, args) => ({ data: {
    version: 1, confirmed: true, replayed: false, tenant_id: args._tenant_id,
    actor_id: state.actor, request_id: args._request_id, command: args._command,
    trip_id: args._payload.trip_id, entity_id: '72000000-0000-4000-8000-000000000006',
  }, error: null }));
});
afterEach(() => { cleanup(); client.clear(); onlineManager.setOnline(true); vi.restoreAllMocks(); });

describe('operational UI with real QueryClient, hook and command service (memory adapter, synthetic transport)', () => {
  for (const mode of ['journey', 'checklist', 'occurrence'] as const) {
    it(`${mode}: stores before reconnection and replays the original scoped request`, async () => {
      const view = await mount(mode); await submit(mode);
      await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('aparelho') })));
      const [saved] = await driverOfflineOutbox.list(tenant, actor);
      expect(saved).toMatchObject({ kind: mode, state: 'queued', attempts: 0, tenantId: tenant, actorId: actor, aggregateId: state.trip });
      expect(client.getMutationCache().getAll()[0].state).toMatchObject({ status: 'success', isPaused: false });
      expect(state.rpc).not.toHaveBeenCalled();
      await act(async () => { state.actor = '72000000-0000-4000-8000-000000000009'; view.rerender(); });
      await act(async () => { vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true); onlineManager.setOnline(true); });
      await act(async () => { await operational.recover(); });
      expect(state.rpc).not.toHaveBeenCalled();
      expect(await driverOfflineOutbox.list(tenant, actor)).toEqual([saved]);
      await act(async () => { state.actor = actor; state.tenant = '72000000-0000-4000-8000-000000000010'; view.rerender(); });
      await act(async () => { await operational.recover(); });
      expect(state.rpc).not.toHaveBeenCalled();
      await act(async () => { state.tenant = tenant; view.rerender(); });
      await act(async () => { await operational.recover(); });
      expect(state.rpc).toHaveBeenCalledTimes(1);
      expect(state.rpc).toHaveBeenCalledWith('driver_apply_offline_command_v1', {
        _tenant_id: tenant, _request_id: saved.id, _command: mode === 'journey' ? 'journey_event' : mode, _payload: saved.payload,
      });
      expect(await driverOfflineOutbox.list(tenant, actor)).toHaveLength(0);
      await act(async () => { await operational.recover(); });
      expect(state.rpc).toHaveBeenCalledTimes(1);
    });
  }
  it('acknowledges only after the storage adapter confirms the write', async () => {
    const put = driverOfflineOutbox.put.bind(driverOfflineOutbox);
    let release!: () => void;
    vi.spyOn(driverOfflineOutbox, 'put').mockImplementation(async row => {
      await new Promise<void>(resolve => { release = resolve; }); await put(row);
    });
    await mount('journey'); await submit('journey');
    await waitFor(() => expect(driverOfflineOutbox.put).toHaveBeenCalledTimes(1));
    expect(state.toast).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled();
    expect(await driverOfflineOutbox.list(tenant, actor)).toHaveLength(0);
    await act(async () => { release(); });
    await waitFor(() => expect(state.toast).toHaveBeenCalledTimes(1));
    expect(await driverOfflineOutbox.list(tenant, actor)).toHaveLength(1);
  });
  it('does not announce a saved event when local storage rejects', async () => {
    vi.spyOn(driverOfflineOutbox, 'put').mockRejectedValueOnce(new Error('Armazenamento indisponível.'));
    await mount('journey'); await submit('journey');
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', description: 'Armazenamento indisponível.' })));
    expect(state.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Evento salvo no aparelho' }));
    expect(await driverOfflineOutbox.list(tenant, actor)).toHaveLength(0); expect(state.rpc).not.toHaveBeenCalled();
  });
});
